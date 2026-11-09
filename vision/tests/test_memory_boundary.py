from pathlib import Path
import json
import subprocess
import sys

import pytest


@pytest.mark.real_model
def test_real_worker_success_rejection_and_close_have_no_application_io_or_content_logs():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-B", str(root / "scripts" / "verify_memory.py")],
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode()
    assert result.stderr == b""
    assert json.loads(result.stdout) == {
        "synthetic_successes": 3,
        "rejections": 3,
        "forbidden_io": 0,
        "new_python_threads": 0,
        "model_active": True,
    }
    assert b"synthetic-private-sentinel" not in result.stdout
