from __future__ import annotations

import hashlib
import json

import cv2
import numpy as np
import pytest

from smartbord_vision import person_detection as module
from smartbord_vision.person_detection import YoloPersonDetector


def test_missing_and_invalid_models_do_not_download_or_fabricate_detections(
    tmp_path, monkeypatch
):
    def forbidden(*args, **kwargs):
        raise AssertionError("No unverified model may enter the native decoder")

    monkeypatch.setattr(cv2.dnn, "readNetFromONNX", forbidden)
    model = tmp_path / "model.onnx"
    lock = tmp_path / "model.json"
    missing = YoloPersonDetector(model, lock)
    result = missing.detect(np.zeros((240, 320, 3), np.uint8))
    assert result.status == "unavailable" and result.reason == "model_missing"
    assert result.boxes == () and result.inference_ms is None
    lock.write_text(
        json.dumps(
            {
                "model": "YOLO11n",
                "input_size": 640,
                "output_shape": [1, 84, 8400],
                "onnx_sha256": "0" * 64,
            }
        )
    )
    model.write_bytes(b"synthetic-invalid-model")
    invalid = YoloPersonDetector(model, lock)
    result = invalid.detect(np.zeros((240, 320, 3), np.uint8))
    assert result.status == "unavailable" and result.reason == "model_invalid"
    assert result.boxes == ()
    invalid.close()


def test_oversized_model_is_rejected_before_native_load(tmp_path, monkeypatch):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"x" * (module.MAX_MODEL_BYTES + 1))
    lock = tmp_path / "model.json"
    lock.write_text(
        json.dumps(
            {
                "model": "YOLO11n",
                "input_size": 640,
                "output_shape": [1, 84, 8400],
                "onnx_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            }
        )
    )

    def forbidden(*args, **kwargs):
        raise AssertionError("Oversized model must not load")

    monkeypatch.setattr(cv2.dnn, "readNetFromONNX", forbidden)
    assert (
        YoloPersonDetector(model, lock).detect(np.zeros((32, 32, 3), np.uint8)).reason
        == "model_invalid"
    )


class MeasuredNet:
    def __init__(self):
        self.input = None
        self.active_forwards = 0
        self.neutral_forwards = 0
        self.invalid = False
        self.fail_neutral = False

    def setPreferableBackend(self, backend):
        assert backend == cv2.dnn.DNN_BACKEND_OPENCV

    def setPreferableTarget(self, target):
        assert target == cv2.dnn.DNN_TARGET_CPU

    def setInput(self, value):
        self.input = value.copy()

    def forward(self):
        output = np.zeros((1, 84, 8400), np.float32)
        if self.input.any():
            self.active_forwards += 1
            # 320x240 source -> 640x480 with 80px top letterbox.
            output[0, :4, :3] = np.array(
                [[320, 320, 100], [320, 320, 120], [320, 320, 100], [240, 240, 100]]
            )
            output[0, 4, :3] = [0.9, 0.8, 0.7]
            output[0, 5, 2] = (
                0.99  # Another class winning over person must be excluded.
            )
            if self.invalid:
                output[0, 0, 0] = np.nan
        else:
            self.neutral_forwards += 1
            if self.fail_neutral:
                raise RuntimeError("synthetic-private-marker")
        return output


def fixture_detector(tmp_path, monkeypatch):
    model = tmp_path / "model.onnx"
    model.write_bytes(b"synthetic-network-fixture")
    lock = tmp_path / "model.json"
    lock.write_text(
        json.dumps(
            {
                "model": "YOLO11n",
                "input_size": 640,
                "output_shape": [1, 84, 8400],
                "onnx_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            }
        )
    )
    network = MeasuredNet()
    monkeypatch.setattr(cv2.dnn, "readNetFromONNX", lambda *args: network)
    return YoloPersonDetector(model, lock), network


def test_letterbox_mapping_class_selection_nms_fresh_inference_and_neutral_cleanup(
    tmp_path, monkeypatch
):
    detector, network = fixture_detector(tmp_path, monkeypatch)
    frame = np.full((240, 320, 3), 235, np.uint8)
    for _ in range(2):
        result = detector.detect(frame)
        assert result.status == "available"
        assert (
            len(result.boxes) == 1
        )  # Duplicate suppression and other-class filtering.
        assert result.boxes[0].box == pytest.approx((0.25, 0.25, 0.75, 0.75))
        assert result.boxes[0].confidence == pytest.approx(0.9)
        assert np.count_nonzero(network.input) == 0
    assert network.active_forwards == 2
    assert (
        network.neutral_forwards == 3
    )  # Initialization plus cleanup after each frame.
    detector.close()


@pytest.mark.parametrize("failure", ["invalid_prediction", "neutral_cleanup"])
def test_inference_or_cleanup_failure_is_unknown_and_does_not_echo_errors(
    tmp_path, monkeypatch, failure
):
    detector, network = fixture_detector(tmp_path, monkeypatch)
    network.invalid = failure == "invalid_prediction"
    network.fail_neutral = failure == "neutral_cleanup"
    result = detector.detect(np.full((240, 320, 3), 235, np.uint8))
    assert result.status == "unavailable" and result.reason == "inference_failed"
    assert result.boxes == () and result.inference_ms is None
    assert "synthetic-private-marker" not in repr(result)
    detector.close()


@pytest.mark.real_model
def test_real_local_pretrained_model_detects_public_people_without_runtime_sdk_or_network():
    import importlib.util

    assert importlib.util.find_spec("ultralytics") is None
    assert importlib.util.find_spec("torch") is None
    image_path = module.ROOT / ".cache" / "fixtures" / "bus.jpg"
    fixture_lock = json.loads((module.ROOT / "test-fixture-lock.json").read_text())
    data = image_path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == fixture_lock["sha256"]
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    detector = YoloPersonDetector()
    try:
        for _ in range(2):
            result = detector.detect(frame)
            assert result.status == "available", (
                "Run explicit model preparation before real-model tests."
            )
            assert len(result.boxes) >= 2
            assert result.inference_ms is not None and result.inference_ms > 0
            for person in result.boxes:
                x1, y1, x2, y2 = person.box
                assert 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1
                assert 0.35 <= person.confidence <= 1
    finally:
        frame.fill(0)
        detector.close()
