"""One in-flight frame, returned as caller-owned bytes; no history or saved baseline."""

import math
import threading

import cv2

from .contracts import (
    Corners,
    Detector,
    FrameResult,
    Image,
    MAX_PEOPLE,
    MAX_RESULT_JPEG_BYTES,
    PersonResult,
    VisionBusyError,
    VisionError,
    VisionProcessingError,
    Visibility,
)
from .decoding import decode_jpeg
from .geometry import person_box_overlap, rectify, validate_corners
from .person_detection import YoloPersonDetector
from .quality import enhance, measure_quality


class FrameWorker:
    def __init__(self, detector: Detector | None = None) -> None:
        cv2.setNumThreads(2)
        cv2.ocl.setUseOpenCL(False)
        self._detector = detector if detector is not None else YoloPersonDetector()
        self._lock = threading.Lock()
        self._closed = False

    @staticmethod
    def _encode(image: Image) -> bytes:
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        try:
            if not ok or not 0 < encoded.size <= MAX_RESULT_JPEG_BYTES:
                raise VisionProcessingError()
            return encoded.tobytes()
        finally:
            encoded.fill(0)

    def process(
        self, jpeg: bytes, width: int, height: int, corners: Corners
    ) -> FrameResult:
        if not self._lock.acquire(blocking=False):
            raise VisionBusyError()
        arrays: list[Image] = []
        try:
            if self._closed:
                raise VisionProcessingError()
            validate_corners(corners)
            frame = decode_jpeg(jpeg, width, height)
            arrays.append(frame)
            board = rectify(frame, corners)
            arrays.append(board)
            quality = measure_quality(board)
            enhanced = enhance(board)
            arrays.append(enhanced)
            try:
                people = self._detector.detect(frame)
                if people.status == "available" and (
                    people.reason is not None
                    or people.inference_ms is None
                    or not math.isfinite(people.inference_ms)
                    or people.inference_ms < 0
                    or len(people.boxes) > MAX_PEOPLE
                ):
                    raise VisionProcessingError()
                if people.status == "unavailable":
                    people = PersonResult(
                        "unavailable", reason=people.reason or "inference_failed"
                    )
                elif people.status != "available":
                    raise VisionProcessingError()
                overlap = (
                    person_box_overlap(frame.shape, corners, people.boxes)
                    if people.status == "available"
                    else None
                )
            except Exception:
                people = PersonResult("unavailable", reason="inference_failed")
                overlap = None
            visibility: Visibility = (
                "unknown"
                if overlap is None
                else "detected_obstruction"
                if overlap > 0
                else "no_detected_obstruction"
            )
            return FrameResult(
                width,
                height,
                corners,
                board.shape[1],
                board.shape[0],
                self._encode(board),
                self._encode(enhanced),
                quality,
                people,
                overlap,
                visibility,
            )
        except VisionError:
            raise
        except Exception:
            raise VisionProcessingError() from None
        finally:
            for image in arrays:
                image.fill(0)
            self._lock.release()

    def close(self) -> None:
        if not self._lock.acquire(blocking=False):
            raise VisionBusyError()
        try:
            self._closed = True
            self._detector.close()
        finally:
            self._lock.release()
