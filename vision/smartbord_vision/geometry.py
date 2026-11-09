"""Validated confirmed geometry, rectification and conservative person-box overlap."""

import math

import cv2
import numpy as np
from numpy.typing import NDArray

from .contracts import (
    Corners,
    Image,
    MAX_PEOPLE,
    MAX_RECTIFIED_HEIGHT,
    MAX_RECTIFIED_WIDTH,
    PersonBox,
    VisionError,
)


def validate_corners(points: Corners) -> NDArray[np.float32]:
    if type(points) is not tuple or len(points) != 4:
        raise VisionError()
    for point in points:
        if (
            type(point) is not tuple
            or len(point) != 2
            or any(
                type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1
                for v in point
            )
        ):
            raise VisionError()
    values = np.array(points, dtype=np.float32)
    # Require a convex clockwise cycle. The first supplied corner defines output TL.
    if (
        not cv2.isContourConvex(values)
        or cv2.contourArea(values, oriented=True) < 0.025
        or min(np.linalg.norm(values[i] - values[(i + 1) % 4]) for i in range(4))
        < 0.025
    ):
        raise VisionError()
    return values


def rectify(frame: Image, points: Corners) -> Image:
    height, width = frame.shape[:2]
    source = validate_corners(points) * np.array(
        [width - 1, height - 1], dtype=np.float32
    )
    out_w = float(
        max(
            np.linalg.norm(source[1] - source[0]), np.linalg.norm(source[2] - source[3])
        )
        + 1
    )
    out_h = float(
        max(
            np.linalg.norm(source[3] - source[0]), np.linalg.norm(source[2] - source[1])
        )
        + 1
    )
    scale = min(1.0, MAX_RECTIFIED_WIDTH / out_w, MAX_RECTIFIED_HEIGHT / out_h)
    target_w, target_h = round(out_w * scale), round(out_h * scale)
    if target_w < 32 or target_h < 32:
        raise VisionError()
    target = np.array(
        [[0, 0], [target_w - 1, 0], [target_w - 1, target_h - 1], [0, target_h - 1]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(source.astype(np.float32), target)
    return cv2.warpPerspective(frame, transform, (target_w, target_h)).astype(
        np.uint8, copy=False
    )


def person_box_overlap(
    shape: tuple[int, ...], points: Corners, boxes: tuple[PersonBox, ...]
) -> float:
    if len(boxes) > MAX_PEOPLE:
        raise VisionError()
    height, width = shape[:2]
    scale = min(1.0, 640 / max(width, height))
    mask_w, mask_h = max(2, round(width * scale)), max(2, round(height * scale))
    board = np.zeros((mask_h, mask_w), dtype=np.uint8)
    people = np.zeros_like(board)
    try:
        polygon = np.round(validate_corners(points) * [mask_w - 1, mask_h - 1]).astype(
            np.int32
        )
        cv2.fillConvexPoly(board, polygon, 1)
        for person in boxes:
            x1, y1, x2, y2 = person.box
            if (
                not all(math.isfinite(v) and 0 <= v <= 1 for v in person.box)
                or not x1 < x2
                or not y1 < y2
                or not math.isfinite(person.confidence)
                or not 0 <= person.confidence <= 1
            ):
                raise VisionError()
            cv2.rectangle(
                people,
                (round(x1 * (mask_w - 1)), round(y1 * (mask_h - 1))),
                (round(x2 * (mask_w - 1)), round(y2 * (mask_h - 1))),
                1,
                -1,
            )
        return float(
            int(np.count_nonzero(board & people)) / max(1, int(np.count_nonzero(board)))
        )
    finally:
        board.fill(0)
        people.fill(0)
