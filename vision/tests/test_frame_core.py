from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import math
import threading
from unittest.mock import Mock

import cv2
import numpy as np
import pytest

from smartbord_vision import worker as worker_module
from smartbord_vision.contracts import (
    MAX_JPEG_BYTES,
    PersonBox,
    PersonResult,
    VisionBusyError,
    VisionError,
    VisionProcessingError,
)
from smartbord_vision.decoding import decode_jpeg
from smartbord_vision.geometry import person_box_overlap, rectify, validate_corners
from smartbord_vision.quality import measure_quality
from smartbord_vision.worker import FrameWorker
from conftest import DisabledDetector, FULL, encode


def test_actual_rectified_and_enhanced_bytes_are_independent_of_source_and_never_a_capture(
    board,
):
    core = FrameWorker(DisabledDetector())
    result = core.process(encode(board), 320, 240, FULL)
    original = cv2.imdecode(
        np.frombuffer(result.rectified_jpeg, np.uint8), cv2.IMREAD_COLOR
    )
    enhanced = cv2.imdecode(
        np.frombuffer(result.enhanced_jpeg, np.uint8), cv2.IMREAD_COLOR
    )
    assert original.shape == enhanced.shape == board.shape
    assert np.abs(original.astype(float) - board).mean() < 4
    assert result.rectified_jpeg != result.enhanced_jpeg
    assert len(result.comparison_signature) == 48 * 32
    assert result.people.status == "unavailable"
    assert result.person_box_overlap_fraction is None
    assert result.visibility == "unknown"
    assert result.tracking == "unverified"
    assert result.automatic_capture_eligible is False
    assert "rectified_jpeg" not in repr(result)
    assert "enhanced_jpeg" not in repr(result)
    assert "comparison_signature" not in repr(result)
    assert result.quality.ink_density > 0
    assert result.quality.sharpness > 0
    core.close()


def test_exif_orientation_does_not_rotate_source_coordinates(board):
    frame = decode_jpeg(encode(board, orientation=6), 320, 240)
    assert frame.shape == (240, 320, 3)
    assert np.abs(frame.astype(float) - board).mean() < 4


@pytest.mark.parametrize(
    "jpeg,width,height",
    [
        (b"", 320, 240),
        (b"synthetic-private-marker", 320, 240),
        (b"\xff\xd8\xff\xd9", 320, 240),
        (b"x" * (MAX_JPEG_BYTES + 1), 320, 240),
        (b"invalid", True, 240),
        (b"invalid", 32, 8193),
        (b"invalid", 8192, 8192),
        (b"invalid", 0, 240),
        (b"invalid", 320.0, 240),
    ],
    ids=[
        "empty",
        "not_jpeg",
        "empty_jpeg",
        "compressed_limit",
        "boolean_axis",
        "axis_limit",
        "pixel_limit",
        "zero_axis",
        "float_axis",
    ],
)
def test_invalid_or_oversized_input_is_rejected_before_native_decode(
    monkeypatch, jpeg, width, height
):
    decode = Mock(side_effect=AssertionError("Native decode must not run"))
    monkeypatch.setattr(cv2, "imdecode", decode)
    with pytest.raises(VisionError) as failure:
        decode_jpeg(jpeg, width, height)
    assert "synthetic-private-marker" not in str(failure.value)
    decode.assert_not_called()


def test_declared_and_header_dimensions_are_checked_before_native_decode(
    monkeypatch, board
):
    jpeg = encode(board)
    bomb = bytearray(jpeg)
    offset = bomb.index(b"\xff\xc0")
    bomb[offset + 5 : offset + 9] = b"\xff\xff\xff\xff"
    decode = Mock(side_effect=AssertionError("Native decode must not run"))
    monkeypatch.setattr(cv2, "imdecode", decode)
    for data, width, height in [
        (jpeg, 640, 480),
        (bytes(bomb), 320, 240),
        (jpeg[:-2], 320, 240),
    ]:
        with pytest.raises(VisionError):
            decode_jpeg(data, width, height)
    decode.assert_not_called()


def test_png_and_cmyk_are_not_accepted_as_camera_jpeg(board):
    from io import BytesIO
    from PIL import Image

    ok, png = cv2.imencode(".png", board)
    assert ok
    cmyk = BytesIO()
    Image.new("CMYK", (320, 240)).save(cmyk, format="JPEG")
    for data in [png.tobytes(), cmyk.getvalue()]:
        with pytest.raises(VisionError):
            decode_jpeg(data, 320, 240)


@pytest.mark.parametrize(
    "points",
    [
        (),
        ((0.0, 0.0),) * 4,
        ((0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0)),
        ((0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)),
        ((0.0, 0.0), (0.01, 0.0), (0.01, 0.01), (0.0, 0.01)),
        ((math.nan, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
        ((math.inf, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
        ((-0.1, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
        ((True, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
        ((0.0, 0.0), (1.0, 0.0), (0.5, 0.3), (0.0, 1.0)),
    ],
)
def test_crossed_concave_tiny_nonfinite_or_reversed_calibration_is_rejected(points):
    with pytest.raises(VisionError):
        validate_corners(points)


def test_perspective_rectification_restores_known_board_and_caps_output(board):
    source = np.array([[0, 0], [319, 0], [319, 239], [0, 239]], np.float32)
    dest = np.array([[80, 65], [560, 35], [600, 410], [45, 440]], np.float32)
    frame = cv2.warpPerspective(
        board, cv2.getPerspectiveTransform(source, dest), (640, 480)
    )
    points = tuple((float(x / 639), float(y / 479)) for x, y in dest)
    result = rectify(frame, points)
    restored = cv2.resize(result, (320, 240))
    assert np.abs(restored.astype(float) - board).mean() < 6
    big = np.full((2000, 3000, 3), 235, np.uint8)
    small = rectify(big, FULL)
    assert small.shape[1] <= 960 and small.shape[0] <= 1600


def test_quality_measures_blur_darkness_and_textureless_uncertainty(board):
    sharp = measure_quality(board)
    blurred = measure_quality(cv2.GaussianBlur(board, (25, 25), 9))
    assert blurred.sharpness < sharp.sharpness * 0.1
    assert "possible_blur" in blurred.concerns
    assert "too_dark" in measure_quality(np.zeros_like(board)).concerns
    plain = measure_quality(np.full_like(board, 235))
    assert plain.focus_uncertain
    assert "focus_unknown" in plain.concerns
    assert "possible_blur" not in plain.concerns
    assert (
        "clipped_and_textureless" in measure_quality(np.full_like(board, 255)).concerns
    )


def test_person_overlap_uses_union_and_clips_to_the_actual_polygon():
    person = PersonBox((0.0, 0.0, 0.5, 1.0), 0.9)
    one = person_box_overlap((240, 320, 3), FULL, (person,))
    assert 0.49 <= one <= 0.51
    assert one == person_box_overlap((240, 320, 3), FULL, (person, person))
    inner = ((0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8))
    assert (
        person_box_overlap(
            (240, 320, 3), inner, (PersonBox((0.0, 0.0, 0.1, 1.0), 0.8),)
        )
        == 0
    )


@pytest.mark.parametrize(
    "box,confidence",
    [
        ((0.0, 0.0, 1.0, 1.0), math.nan),
        ((0.0, 0.0, 1.0, 1.0), 1.1),
        ((0.0, 0.0, math.inf, 1.0), 0.8),
        ((0.5, 0.0, 0.1, 1.0), 0.8),
        ((0.0, 0.0, 2.0, 1.0), 0.8),
    ],
)
def test_invalid_person_measurements_are_rejected(box, confidence):
    with pytest.raises(VisionError):
        person_box_overlap((240, 320, 3), FULL, (PersonBox(box, confidence),))


def test_stationary_obstruction_is_remeasured_on_every_frame_and_owned_pixels_are_cleared(
    board,
):
    class ObservedDetector(DisabledDetector):
        def __init__(self):
            self.observed = []

        def detect(self, frame):
            self.observed.append(frame)
            return PersonResult(
                "available", (PersonBox((0.2, 0.2, 0.6, 0.9), 0.8),), 1.0
            )

    detector = ObservedDetector()
    core = FrameWorker(detector)
    for _ in range(2):
        result = core.process(encode(board), 320, 240, FULL)
        assert result.visibility == "detected_obstruction"
        assert result.person_box_overlap_fraction > 0
        assert result.automatic_capture_eligible is False
    assert len(detector.observed) == 2
    assert all(np.count_nonzero(frame) == 0 for frame in detector.observed)
    core.close()


def test_detector_failure_is_unknown_and_never_returns_fake_clear_visibility(board):
    class FailedDetector(DisabledDetector):
        def detect(self, frame):
            raise RuntimeError("synthetic-private-marker")

    core = FrameWorker(FailedDetector())
    result = core.process(encode(board), 320, 240, FULL)
    assert result.visibility == "unknown"
    assert result.person_box_overlap_fraction is None
    assert result.people.boxes == ()
    assert "synthetic-private-marker" not in repr(result)
    core.close()


def test_one_in_flight_frame_rejects_work_and_close_without_a_backlog(board):
    entered, release = threading.Event(), threading.Event()

    class BlockingDetector(DisabledDetector):
        def detect(self, frame):
            entered.set()
            assert release.wait(3)
            return PersonResult("available", (), 1.0)

    core = FrameWorker(BlockingDetector())
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(core.process, encode(board), 320, 240, FULL)
        try:
            assert entered.wait(3)
            with pytest.raises(VisionBusyError):
                core.process(encode(board), 320, 240, FULL)
            with pytest.raises(VisionBusyError):
                core.close()
        finally:
            release.set()
        assert future.result().visibility == "no_detected_obstruction"
    core.close()
    with pytest.raises(VisionProcessingError):
        core.process(encode(board), 320, 240, FULL)


def test_processing_error_is_sanitized_and_releases_the_worker(monkeypatch, board):
    core = FrameWorker(DisabledDetector())
    real = worker_module.enhance

    def failed(frame):
        raise RuntimeError("synthetic-private-marker")

    monkeypatch.setattr(worker_module, "enhance", failed)
    with pytest.raises(VisionProcessingError) as failure:
        core.process(encode(board), 320, 240, FULL)
    assert "synthetic-private-marker" not in str(failure.value)
    monkeypatch.setattr(worker_module, "enhance", real)
    assert core.process(encode(board), 320, 240, FULL).rectified_jpeg
    core.close()


@pytest.mark.parametrize("accepted,size", [(True, 2_000_001), (False, 1)])
def test_output_encoding_failure_and_size_limit_clear_buffers_without_partial_results(
    monkeypatch, board, accepted, size
):
    core = FrameWorker(DisabledDetector())
    jpeg = encode(board)
    encoded = np.ones(size, np.uint8)
    monkeypatch.setattr(cv2, "imencode", lambda *args: (accepted, encoded))
    with pytest.raises(VisionProcessingError):
        core.process(jpeg, 320, 240, FULL)
    assert np.count_nonzero(encoded) == 0
    core.close()
