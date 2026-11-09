"""Private persistent stdio worker. No HTTP listener or command-line frame inputs."""

from __future__ import annotations

import os
from pathlib import Path
import struct
import sys


def main() -> int:
    sys.dont_write_bytecode = True
    # Native-library diagnostics must never reach logs or the protocol pipe.
    sink = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(sink, 2)
    finally:
        os.close(sink)
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except ImportError:
        pass
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    if len(sys.argv) != 1:
        return 1
    from smartbord_vision.bridge_protocol import run

    return run(sys.stdin.buffer, sys.stdout.buffer)


if __name__ == "__main__":
    try:
        exit_code = main()
    except BaseException:
        # No exception text, tracebacks, paths, input headers or JPEG bytes.
        try:
            message = (
                b'{"protocolVersion":1,"type":"error","code":"VISION_UNAVAILABLE"}'
            )
            sys.stdout.buffer.write(struct.pack(">I", len(message)) + message)
            sys.stdout.buffer.flush()
        except BaseException:
            pass
        exit_code = 1
    raise SystemExit(exit_code)
