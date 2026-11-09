"""Bounded private pipe protocol; no HTTP, credentials, paths or durable records."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import math
import os
import struct
import sys
from typing import BinaryIO, Literal, cast
from uuid import UUID

from .contracts import (
    Corners,
    FrameResult,
    MAX_DECODED_PIXELS,
    MAX_IMAGE_AXIS,
    MAX_JPEG_BYTES,
    MAX_RESULT_JPEG_BYTES,
    VisionError,
    VisionProcessingError,
)
from .geometry import validate_corners
from .worker import FrameWorker

MAX_REQUEST_HEADER_BYTES = 8_192
MAX_RESULT_HEADER_BYTES = 32_768
PROTOCOL_VERSION = 1


class BridgeProtocolError(ValueError):
    def __init__(self) -> None:
        super().__init__("Invalid worker request.")


@dataclass(frozen=True)
class FrameRequest:
    request_id: str
    width: int
    height: int
    corners: Corners
    jpeg_bytes: int


def clear(buffer: bytearray | None) -> None:
    if buffer is not None:
        buffer[:] = b"\x00" * len(buffer)


def read_exact(
    source: BinaryIO, count: int, *, allow_eof: bool = False
) -> bytearray | None:
    buffer = bytearray(count)
    offset = 0
    try:
        while offset < count:
            chunk = source.read(count - offset)
            received = len(chunk)
            if not received:
                if allow_eof and offset == 0:
                    clear(buffer)
                    return None
                raise BridgeProtocolError()
            buffer[offset : offset + received] = chunk
            offset += received
        return buffer
    except BaseException:
        clear(buffer)
        raise


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise BridgeProtocolError()
        result[key] = value
    return result


def _constant(_value: str) -> object:
    raise BridgeProtocolError()


def _canonical_uuid(value: object) -> str:
    if type(value) is not str or len(value) != 36:
        raise BridgeProtocolError()
    try:
        if str(UUID(value)) != value:
            raise BridgeProtocolError()
    except (ValueError, AttributeError):
        raise BridgeProtocolError() from None
    return value


def parse_request(header: bytes | bytearray) -> FrameRequest:
    try:
        data = json.loads(
            header.decode("utf8", errors="strict"),
            object_pairs_hook=_pairs,
            parse_constant=_constant,
        )
        if type(data) is not dict or set(data) != {
            "protocolVersion",
            "type",
            "requestId",
            "width",
            "height",
            "corners",
            "jpegBytes",
        }:
            raise BridgeProtocolError()
        if (
            type(data["protocolVersion"]) is not int
            or data["protocolVersion"] != PROTOCOL_VERSION
            or data["type"] != "frame"
        ):
            raise BridgeProtocolError()
        request_id = _canonical_uuid(data["requestId"])
        width, height, jpeg_bytes = data["width"], data["height"], data["jpegBytes"]
        if (
            type(width) is not int
            or type(height) is not int
            or not 32 <= width <= MAX_IMAGE_AXIS
            or not 32 <= height <= MAX_IMAGE_AXIS
            or width * height > MAX_DECODED_PIXELS
            or type(jpeg_bytes) is not int
            or not 1 <= jpeg_bytes <= MAX_JPEG_BYTES
        ):
            raise BridgeProtocolError()
        points = data["corners"]
        if type(points) is not list or len(points) != 4:
            raise BridgeProtocolError()
        for point in points:
            if type(point) is not list or len(point) != 2:
                raise BridgeProtocolError()
            if any(
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not 0 <= value <= 1
                for value in point
            ):
                raise BridgeProtocolError()
        corners = cast(Corners, tuple(tuple(point) for point in points))
        validate_corners(corners)
        return FrameRequest(request_id, width, height, corners, jpeg_bytes)
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise BridgeProtocolError() from None


def read_request(source: BinaryIO) -> FrameRequest | None:
    prefix: bytearray | None = None
    header: bytearray | None = None
    try:
        prefix = read_exact(source, 4, allow_eof=True)
        if prefix is None:
            return None
        length = struct.unpack(">I", prefix)[0]
        if not 1 <= length <= MAX_REQUEST_HEADER_BYTES:
            raise BridgeProtocolError()
        header = read_exact(source, length)
        if header is None:
            raise BridgeProtocolError()
        return parse_request(header)
    finally:
        clear(prefix)
        clear(header)


def _write_all(destination: BinaryIO, content: bytes | bytearray | memoryview) -> None:
    view = memoryview(content)
    written = 0
    while written < len(view):
        count = destination.write(view[written:])
        if count is None or count <= 0:
            raise BrokenPipeError()
        written += count


def write_header(destination: BinaryIO, header: dict[str, object]) -> None:
    content = json.dumps(
        header, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("utf8")
    if not 1 <= len(content) <= MAX_RESULT_HEADER_BYTES:
        raise VisionProcessingError()
    _write_all(destination, struct.pack(">I", len(content)))
    _write_all(destination, content)


def write_error(
    destination: BinaryIO,
    code: Literal["VALIDATION_ERROR", "VISION_UNAVAILABLE"],
    request_id: str | None = None,
) -> None:
    header: dict[str, object] = {
        "protocolVersion": PROTOCOL_VERSION,
        "type": "error",
        "code": code,
    }
    if request_id is not None:
        header["requestId"] = _canonical_uuid(request_id)
    write_header(destination, header)
    destination.flush()


def result_measurements(result: FrameResult) -> dict[str, object]:
    # Never asdict(FrameResult): that would copy both private JPEG byte strings.
    return {
        "source_width": result.source_width,
        "source_height": result.source_height,
        "corners": result.corners,
        "rectified_width": result.rectified_width,
        "rectified_height": result.rectified_height,
        "quality": asdict(result.quality),
        "people": asdict(result.people),
        "person_box_overlap_fraction": result.person_box_overlap_fraction,
        "visibility": result.visibility,
        "tracking": result.tracking,
        "automatic_capture_eligible": result.automatic_capture_eligible,
    }


def process_request(
    worker: FrameWorker,
    request: FrameRequest,
    source: BinaryIO,
    destination: BinaryIO,
    guard: RuntimeGuard,
) -> None:
    body: bytearray | None = None
    rectified: bytearray | None = None
    enhanced: bytearray | None = None
    result: FrameResult | None = None
    try:
        body = read_exact(source, request.jpeg_bytes)
        if body is None:
            raise BridgeProtocolError()
        result = worker.process(body, request.width, request.height, request.corners)
        if (
            guard.violated
            or result.tracking != "unverified"
            or result.automatic_capture_eligible is not False
        ):
            raise VisionProcessingError()
        rectified = bytearray(result.rectified_jpeg)
        enhanced = bytearray(result.enhanced_jpeg)
        if not (
            1 <= len(rectified) <= MAX_RESULT_JPEG_BYTES
            and 1 <= len(enhanced) <= MAX_RESULT_JPEG_BYTES
            and rectified.startswith(b"\xff\xd8")
            and rectified.endswith(b"\xff\xd9")
            and enhanced.startswith(b"\xff\xd8")
            and enhanced.endswith(b"\xff\xd9")
        ):
            raise VisionProcessingError()
        write_header(
            destination,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "type": "result",
                "requestId": request.request_id,
                "rectifiedBytes": len(rectified),
                "enhancedBytes": len(enhanced),
                "measurements": result_measurements(result),
            },
        )
        _write_all(destination, rectified)
        _write_all(destination, enhanced)
        destination.flush()
    finally:
        clear(body)
        clear(rectified)
        clear(enhanced)
        result = None


class RuntimeGuard:
    """Application-level IO prohibition after model/import initialization."""

    def __init__(self) -> None:
        self.violated = False

    def deny(self, *_args: object, **_kwargs: object) -> None:
        self.violated = True
        raise RuntimeError("Worker IO is unavailable.")

    def audit(self, event: str, args: tuple[object, ...]) -> None:
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else None
        writing = event == "open" and (
            (isinstance(mode, str) and any(flag in mode for flag in "wax+"))
            or (
                isinstance(flags, int)
                and flags
                & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
                != 0
            )
        )
        if (
            writing
            or event.startswith("socket.")
            or event.startswith("subprocess.")
            or event.startswith("sqlite3.")
            or event
            in {
                "os.mkdir",
                "os.rename",
                "os.remove",
                "os.rmdir",
                "os.system",
                "os.link",
                "os.symlink",
                "os.truncate",
            }
        ):
            self.deny()

    def activate(self) -> None:
        import cv2
        import socket

        sys.addaudithook(self.audit)
        for name in ("imwrite", "imwritemulti", "FileStorage"):
            setattr(cv2, name, self.deny)
        setattr(socket, "socket", self.deny)


def run(source: BinaryIO, destination: BinaryIO) -> int:
    import cv2
    import numpy as np
    from .person_detection import YoloPersonDetector

    cv2.setNumThreads(2)
    cv2.ocl.setUseOpenCL(False)
    detector = YoloPersonDetector()
    worker = FrameWorker(detector)
    guard = RuntimeGuard()
    guard.activate()
    try:
        neutral = np.zeros((32, 32, 3), dtype=np.uint8)
        try:
            available = detector.detect(neutral).status == "available"
        finally:
            neutral.fill(0)
        write_header(
            destination,
            {"protocolVersion": PROTOCOL_VERSION, "type": "ready", "vision": available},
        )
        destination.flush()
        if not available:
            return 1
        while True:
            request_id: str | None = None
            try:
                request = read_request(source)
                if request is None:
                    return 0
                request_id = request.request_id
                process_request(worker, request, source, destination, guard)
                # Do not retain the previous request while blocked on the next prefix.
                del request
                request_id = None
            except (BridgeProtocolError, VisionError) as error:
                code: Literal["VALIDATION_ERROR", "VISION_UNAVAILABLE"] = (
                    "VISION_UNAVAILABLE"
                    if isinstance(error, VisionProcessingError)
                    else "VALIDATION_ERROR"
                )
                write_error(destination, code, request_id)
                return 1
            except Exception:
                write_error(destination, "VISION_UNAVAILABLE", request_id)
                return 1
    finally:
        worker.close()
