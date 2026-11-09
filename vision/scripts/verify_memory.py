"""Run synthetic success/error/close paths with guarded IO. Prints no image/results."""

from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    sys.path.insert(0, str(ROOT))
    import cv2
    import numpy as np
    from smartbord_vision.contracts import VisionError
    from smartbord_vision.worker import FrameWorker

    cv2.setNumThreads(2)
    worker = FrameWorker()
    frame = np.full((240, 320, 3), 235, dtype=np.uint8)
    cv2.putText(
        frame,
        "SYNTHETIC MEMORY CHECK",
        (8, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (20, 20, 20),
        1,
    )
    ok, encoded = cv2.imencode(".jpg", frame)
    assert ok
    jpeg = encoded.tobytes()
    corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    # Directory creation is setup only; no frame enters a file.
    with tempfile.TemporaryDirectory(prefix="sbt-vision-audit-") as directory:
        monitored = Path(directory)
        forbidden: list[str] = []
        violation = "Worker attempted forbidden IO."
        active = True

        def audit(event: str, args: tuple[object, ...]) -> None:
            if not active:
                return
            writing = event == "open" and (
                (isinstance(args[1], str) and any(flag in args[1] for flag in "wax+"))
                or (
                    isinstance(args[2], int)
                    and args[2]
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
                in {"os.mkdir", "os.rename", "os.remove", "os.rmdir", "os.system"}
            ):
                forbidden.append(event)
                raise RuntimeError(violation)

        def denied(*args: object, **kwargs: object) -> None:
            forbidden.append("native filesystem/network API")
            raise RuntimeError(violation)

        before_threads = {thread.ident for thread in threading.enumerate()}
        sys.addaudithook(audit)
        original = {
            name: getattr(cv2, name)
            for name in ("imwrite", "imwritemulti", "FileStorage")
        }
        for name in original:
            setattr(cv2, name, denied)
        original_socket = socket.socket
        socket.socket = denied  # type: ignore[assignment]
        try:
            for _ in range(3):
                result = worker.process(jpeg, 320, 240, corners)
                assert result.people.status == "available", (
                    "Explicit local model preparation is required."
                )
                assert result.automatic_capture_eligible is False
                assert result.rectified_jpeg.startswith(b"\xff\xd8")
                assert result.enhanced_jpeg.startswith(b"\xff\xd8")
                # Decode the real returned bytes in memory, then discard them.
                decoded = cv2.imdecode(
                    np.frombuffer(result.rectified_jpeg, np.uint8), cv2.IMREAD_COLOR
                )
                assert decoded.shape == frame.shape
                decoded.fill(0)
                del result
            for invalid in [b"synthetic-private-sentinel", jpeg[:-2], b"x" * 2_000_001]:
                try:
                    worker.process(invalid, 320, 240, corners)
                except VisionError as error:
                    assert "synthetic-private-sentinel" not in str(error)
                else:
                    raise AssertionError("Invalid frame was accepted.")
            worker.close()
            assert not forbidden
            assert not list(monitored.iterdir())
            assert {thread.ident for thread in threading.enumerate()} == before_threads
        finally:
            active = False
            socket.socket = original_socket
            for name, function in original.items():
                setattr(cv2, name, function)
            frame.fill(0)
            encoded.fill(0)
    print(
        json.dumps(
            {
                "synthetic_successes": 3,
                "rejections": 3,
                "forbidden_io": 0,
                "new_python_threads": 0,
                "model_active": True,
            }
        )
    )


if __name__ == "__main__":
    main()
