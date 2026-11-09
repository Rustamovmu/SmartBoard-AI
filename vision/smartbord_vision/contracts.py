"""Bounded internal Python interface. It is not the future socket wire protocol."""

from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np
from numpy.typing import NDArray

MAX_JPEG_BYTES = 2_000_000
MAX_DECODED_PIXELS = 16_000_000
MAX_IMAGE_AXIS = 8_192
MAX_RECTIFIED_WIDTH = 960
MAX_RECTIFIED_HEIGHT = 1_600
MAX_RESULT_JPEG_BYTES = 2_000_000
MAX_PEOPLE = 100
Point = tuple[float, float]
Corners = tuple[Point, Point, Point, Point]
Visibility = Literal["unknown", "detected_obstruction", "no_detected_obstruction"]
Image = NDArray[np.uint8]


class VisionError(ValueError):
    code = "VALIDATION_ERROR"

    def __init__(self) -> None:
        super().__init__("Invalid frame or calibration.")


class VisionBusyError(VisionError):
    code = "ANALYSIS_BUSY"

    def __init__(self) -> None:
        ValueError.__init__(self, "Frame worker is busy.")


class VisionProcessingError(VisionError):
    code = "VISION_UNAVAILABLE"

    def __init__(self) -> None:
        ValueError.__init__(self, "Frame processing is unavailable.")


@dataclass(frozen=True)
class PersonBox:
    box: tuple[float, float, float, float]
    confidence: float


@dataclass(frozen=True)
class PersonResult:
    status: Literal["available", "unavailable"]
    boxes: tuple[PersonBox, ...] = ()
    inference_ms: float | None = None
    reason: (
        Literal[
            "model_missing", "model_invalid", "inference_failed", "detector_disabled"
        ]
        | None
    ) = None


class Detector(Protocol):
    def detect(self, frame: Image) -> PersonResult: ...
    def close(self) -> None: ...


@dataclass(frozen=True)
class Quality:
    sharpness: float
    brightness: float
    dark_fraction: float
    highlight_fraction: float
    ink_density: float
    focus_uncertain: bool
    concerns: tuple[str, ...]


@dataclass(frozen=True)
class FrameResult:
    source_width: int
    source_height: int
    corners: Corners
    rectified_width: int
    rectified_height: int
    rectified_jpeg: bytes = field(repr=False)
    enhanced_jpeg: bytes = field(repr=False)
    quality: Quality
    people: PersonResult
    person_box_overlap_fraction: float | None
    visibility: Visibility
    tracking: Literal["unverified"] = "unverified"
    automatic_capture_eligible: Literal[False] = False
