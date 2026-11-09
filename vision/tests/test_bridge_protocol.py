from __future__ import annotations

from io import BytesIO
import json
import struct
from uuid import uuid4

import pytest

from smartbord_vision.bridge_protocol import (
    BridgeProtocolError,
    RuntimeGuard,
    parse_request,
    read_request,
    read_exact,
    write_header,
)


def request_header(request_id: str | None = None, **overrides: object) -> bytes:
    values: dict[str, object] = {
        "protocolVersion": 1,
        "type": "frame",
        "requestId": request_id or str(uuid4()),
        "width": 320,
        "height": 240,
        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
        "jpegBytes": 4,
    }
    values.update(overrides)
    return json.dumps(values, separators=(",", ":")).encode()


def test_parses_strict_bounded_frame_metadata_without_jpeg() -> None:
    header = request_header()
    request = parse_request(header)
    assert request.width == 320
    assert request.height == 240
    assert request.jpeg_bytes == 4
    assert request.corners == ((0, 0), (1, 0), (1, 1), (0, 1))


@pytest.mark.parametrize(
    "header",
    [
        request_header(protocolVersion=True),
        request_header(width=8192, height=8192),
        request_header(jpegBytes=2_000_001),
        request_header(corners=[[0, 0], [1, 1], [1, 0], [0, 1]]),
        request_header().replace(b'"width":320', b'"width":NaN'),
        request_header().replace(b'"width":320', b'"width":320,"width":320'),
    ],
)
def test_rejects_invalid_or_duplicate_header_fields(header: bytes) -> None:
    with pytest.raises(BridgeProtocolError):
        parse_request(header)


def test_reads_exact_frame_body_and_rejects_truncation() -> None:
    header = request_header()
    content = struct.pack(">I", len(header)) + header + b"jpeg"
    source = BytesIO(content)
    parsed = read_request(source)
    assert parsed is not None
    assert parsed.jpeg_bytes == 4
    assert read_exact(source, parsed.jpeg_bytes) == bytearray(b"jpeg")
    with pytest.raises(BridgeProtocolError):
        read_exact(BytesIO(b"jpe"), 4)


def test_eof_between_requests_is_clean() -> None:
    assert read_request(BytesIO()) is None


def test_runtime_guard_refuses_persistence_and_network_events() -> None:
    guard = RuntimeGuard()
    for event, args in (
        ("open", ("capture.jpg", "wb", 0)),
        ("socket.connect", ("example.invalid",)),
        ("subprocess.Popen", ("worker",)),
        ("sqlite3.connect", ("capture.db",)),
        ("os.remove", ("capture.jpg",)),
    ):
        with pytest.raises(RuntimeError):
            guard.audit(event, args)
    assert guard.violated


def test_worker_error_header_does_not_echo_untrusted_message() -> None:
    output = BytesIO()
    write_header(
        output,
        {"protocolVersion": 1, "type": "error", "code": "VALIDATION_ERROR"},
    )
    length = struct.unpack(">I", output.getvalue()[:4])[0]
    assert json.loads(output.getvalue()[4 : 4 + length]) == {
        "protocolVersion": 1,
        "type": "error",
        "code": "VALIDATION_ERROR",
    }
