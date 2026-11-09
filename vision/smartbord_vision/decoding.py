"""Probe JPEG dimensions before OpenCV allocates decoded pixel buffers."""

from io import BytesIO
import warnings

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

from .contracts import (
    MAX_DECODED_PIXELS,
    MAX_IMAGE_AXIS,
    MAX_JPEG_BYTES,
    Image as Pixels,
    VisionError,
)


def decode_jpeg(jpeg: bytes | bytearray, width: int, height: int) -> Pixels:
    if (
        type(jpeg) not in (bytes, bytearray)
        or not 4 <= len(jpeg) <= MAX_JPEG_BYTES
        or type(width) is not int
        or type(height) is not int
        or not 32 <= width <= MAX_IMAGE_AXIS
        or not 32 <= height <= MAX_IMAGE_AXIS
        or width * height > MAX_DECODED_PIXELS
        or not jpeg.startswith(b"\xff\xd8")
        or not jpeg.endswith(b"\xff\xd9")
    ):
        raise VisionError()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(jpeg)) as probe:
                if (
                    probe.format != "JPEG"
                    or probe.size != (width, height)
                    or probe.mode not in ("RGB", "L")
                ):
                    raise VisionError()
                probe.verify()
        # Coordinates refer to encoded, unmirrored source pixels, not EXIF rotation.
        frame = cv2.imdecode(
            np.frombuffer(jpeg, dtype=np.uint8),
            cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION,
        )
        if frame is None or frame.shape != (height, width, 3):
            raise VisionError()
        return frame.astype(np.uint8, copy=False)
    except (
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        cv2.error,
        SyntaxError,
        ValueError,
    ):
        raise VisionError() from None
