from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image as PillowImage
import pytest

from smartbord_vision.contracts import Corners, Image, PersonResult

FULL: Corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))


def synthetic_board() -> Image:
    board = np.full((240, 320, 3), 235, dtype=np.uint8)
    cv2.putText(
        board, "Synthetic x=2", (12, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (15, 15, 15), 2
    )
    cv2.line(board, (25, 145), (290, 145), (180, 45, 25), 3)
    cv2.rectangle(board, (65, 165), (240, 215), (25, 130, 30), 2)
    return board


def encode(image: Image, orientation: int | None = None) -> bytes:
    if orientation:
        buffer = BytesIO()
        exif = PillowImage.Exif()
        exif[274] = orientation
        PillowImage.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).save(
            buffer, format="JPEG", exif=exif, quality=95
        )
        return buffer.getvalue()
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert ok
    return encoded.tobytes()


class DisabledDetector:
    def detect(self, frame: Image) -> PersonResult:
        return PersonResult("unavailable", reason="detector_disabled")

    def close(self) -> None:
        pass


@pytest.fixture
def board() -> Image:
    return synthetic_board()
