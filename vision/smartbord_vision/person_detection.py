"""Local checksum-verified YOLO11n ONNX inference; no SDK, network or result files."""

import hashlib
import json
import math
from pathlib import Path
import threading
import time
from typing import Literal

import cv2
import numpy as np

from .contracts import Image, MAX_PEOPLE, PersonBox, PersonResult, VisionBusyError

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / ".cache" / "models" / "yolo11n.onnx"
LOCK_PATH = ROOT / "model-lock.json"
MAX_MODEL_BYTES = 16_000_000
INPUT_SIZE = 640


class YoloPersonDetector:
    def __init__(
        self, model_path: Path = MODEL_PATH, lock_path: Path = LOCK_PATH
    ) -> None:
        # Paths are trusted local operator configuration, never frame/request fields.
        self._net: cv2.dnn.Net | None = None
        self._lock = threading.Lock()
        self._reason = "model_missing"
        try:
            profile = json.loads(lock_path.read_text(encoding="utf8"))
            with model_path.open("rb") as source:
                model = source.read(MAX_MODEL_BYTES + 1)
            if (
                profile["model"] != "YOLO11n"
                or profile["input_size"] != INPUT_SIZE
                or profile["output_shape"] != [1, 84, 8400]
                or len(model) > MAX_MODEL_BYTES
                or hashlib.sha256(model).hexdigest() != profile["onnx_sha256"]
            ):
                self._reason = "model_invalid"
                return
            net = cv2.dnn.readNetFromONNX(np.frombuffer(model, dtype=np.uint8))
            net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            self._net = net
            self._neutralize()
        except FileNotFoundError:
            self._reason = "model_missing"
            self._net = None
        except Exception:
            self._reason = "model_invalid"
            self._net = None

    def _neutralize(self) -> None:
        if self._net is None:
            return
        neutral = np.zeros((1, 3, INPUT_SIZE, INPUT_SIZE), dtype=np.float32)
        self._net.setInput(neutral)
        result = self._net.forward()
        if result.shape != (1, 84, 8400) or not np.isfinite(result).all():
            raise ValueError("Unsupported model profile.")
        result.fill(0)

    def detect(self, frame: Image) -> PersonResult:
        if not self._lock.acquire(blocking=False):
            raise VisionBusyError()
        arrays: list[np.ndarray] = []
        result = PersonResult("unavailable", reason="inference_failed")
        try:
            if self._net is None:
                reason: Literal["model_missing", "model_invalid"] = (
                    "model_missing"
                    if self._reason == "model_missing"
                    else "model_invalid"
                )
                return PersonResult("unavailable", reason=reason)
            height, width = frame.shape[:2]
            ratio = min(INPUT_SIZE / width, INPUT_SIZE / height)
            resized_w, resized_h = round(width * ratio), round(height * ratio)
            left, top = (
                round((INPUT_SIZE - resized_w) / 2 - 0.1),
                round((INPUT_SIZE - resized_h) / 2 - 0.1),
            )
            resized = cv2.resize(frame, (resized_w, resized_h))
            arrays.append(resized)
            padded = np.full((INPUT_SIZE, INPUT_SIZE, 3), 114, dtype=np.uint8)
            arrays.append(padded)
            padded[top : top + resized_h, left : left + resized_w] = resized
            blob = cv2.dnn.blobFromImage(
                padded, 1 / 255, (INPUT_SIZE, INPUT_SIZE), swapRB=True, crop=False
            )
            arrays.append(blob)
            started = time.perf_counter()
            self._net.setInput(blob)
            predictions = self._net.forward()
            arrays.append(predictions)
            if predictions.shape != (1, 84, 8400) or not np.isfinite(predictions).all():
                raise ValueError("Unsupported prediction shape.")
            detections = predictions[0].T
            classes = np.argmax(detections[:, 4:], axis=1)
            scores = np.max(detections[:, 4:], axis=1)
            selected = np.flatnonzero((classes == 0) & (scores >= 0.35))
            selected = selected[np.argsort(-scores[selected], kind="stable")[:300]]
            boxes: list[list[float]] = []
            confidences: list[float] = []
            for index in selected:
                cx, cy, w, h = map(float, detections[index, :4])
                x1, y1 = (
                    max(0.0, (cx - w / 2 - left) / ratio),
                    max(0.0, (cy - h / 2 - top) / ratio),
                )
                x2, y2 = (
                    min(float(width), (cx + w / 2 - left) / ratio),
                    min(float(height), (cy + h / 2 - top) / ratio),
                )
                confidence = float(scores[index])
                if x1 < x2 and y1 < y2 and 0 <= confidence <= 1:
                    boxes.append([x1, y1, x2 - x1, y2 - y1])
                    confidences.append(confidence)
            indices = (
                cv2.dnn.NMSBoxes(boxes, confidences, 0.35, 0.45, top_k=300)
                if boxes
                else ()
            )
            people: list[PersonBox] = []
            for index in np.asarray(indices, dtype=np.int32).reshape(-1)[:MAX_PEOPLE]:
                x, y, w, h = boxes[int(index)]
                people.append(
                    PersonBox(
                        (x / width, y / height, (x + w) / width, (y + h) / height),
                        confidences[int(index)],
                    )
                )
            duration = (time.perf_counter() - started) * 1000
            if not math.isfinite(duration):
                raise ValueError("Invalid inference time.")
            result = PersonResult("available", tuple(people), duration)
        except Exception:
            result = PersonResult("unavailable", reason="inference_failed")
        finally:
            for array in arrays:
                array.fill(0)
            try:
                # OpenCV Net retains its input/activations. Overwrite with neutral
                # inference rather than keeping the previous person's frame.
                self._neutralize()
            except Exception:
                self._net = None
                self._reason = "model_invalid"
                result = PersonResult("unavailable", reason="inference_failed")
            self._lock.release()
        return result

    def close(self) -> None:
        if not self._lock.acquire(blocking=False):
            raise VisionBusyError()
        try:
            self._net = None
            self._reason = "model_missing"
        finally:
            self._lock.release()
