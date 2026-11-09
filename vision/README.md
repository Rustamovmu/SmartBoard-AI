# Standalone CPU frame worker

This first B4 increment measures one bounded JPEG in RAM. It validates confirmed source corners, rectifies the board, measures appearance quality, runs real YOLO11n person inference on the current source frame, estimates person-box overlap and returns separate rectified/enhanced JPEG bytes. It has no listener, database, lecture catalog, file-output API, baseline, automatic capture or Nest bridge.

The existing Nest sockets still reject media and report unavailable vision. Do not enable the application transport as a way to use this package. [Internal contract](../contracts/vision-worker.md), [verification and remaining work](../docs/Vision_worker_verification.md).

## Reproduce the verified environment

Run from the backend repository root. Verified on Python 3.11.9 / macOS arm64. Other supported wheel platforms need their own verification. Existing Node/npm configuration and application `.env` are independent.

```bash
python3.11 -m venv vision/.venv
vision/.venv/bin/python -m pip install -r vision/requirements-dev-lock.txt
python3.11 -m venv .cache/vision-export-venv
.cache/vision-export-venv/bin/python -m pip install -r vision/requirements-export-lock.txt
.cache/vision-export-venv/bin/python -B vision/scripts/prepare_model.py
```

`requirements.txt` is the small runtime set: headless OpenCV, NumPy and Pillow, all pinned. `requirements-dev-lock.txt` adds pinned tests/lint/types. The separate export lock includes the SDK/PyTorch/ONNX tools for explicit preparation only. They must not process private frames or enter the runtime environment.

Preparation explicitly downloads official YOLO11n weights and a public positive-test image, verifies the original model SHA-256, exports fixed 640×640 FP32/opset-12 ONNX, removes incidental model metadata and checks the reviewed derived checksum. It writes only approved model/configuration/public-test assets under ignored caches. The reviewed model and fixture hashes are committed; weights and images are not. A changed artifact fails preparation. `--record-lock` is a deliberate developer operation for reviewing a newly generated lock, not an automatic repair or runtime fallback.

No runtime dependency/model downloads occur. Missing or invalid weights leave visibility unknown. Model provenance and upstream licensing are linked in [model-lock.json](model-lock.json) and the contract; export does not change the model's upstream terms.

## Use the internal Python interface

Create and reuse `FrameWorker` from `smartbord_vision.worker` with `vision/` on the Python import path. Its `process(jpeg: bytes, width: int, height: int, corners: Corners)` accepts bytes already held in memory, not a filename, URL, account ID or lecture metadata. Corners are a tuple of four normalized `(x, y)` tuples forming a clockwise convex cycle. The first corner defines the rectified top-left; the caller must supply the intended orientation and confirmed board interior.

The result includes source/output dimensions, measured quality, actual normalized person boxes/confidences or an unavailable reason, nullable box-overlap fraction and the two JPEG byte strings. `tracking` stays `unverified` and `automatic_capture_eligible` stays `False`. Never treat a returned result as a phone save or an automatic capture candidate. Never log, serialize to telemetry or persist the frame/result; only the recording phone may own durable lecture data.

Only one call may be in flight per worker. A competing call/close fails immediately; no work queue exists. Reuse the loaded CPU detector, then call `close()` after outstanding work finishes. This synchronous core does not implement cancellation or a worker-process timeout; those are requirements for the future bridge. Results are caller-owned RAM bytes and must be released by that caller. The worker retains no per-frame history or accepted baseline.

## Validate

```bash
vision/.venv/bin/python -m ruff check vision/smartbord_vision vision/scripts vision/tests
vision/.venv/bin/python -m ruff format --check vision/smartbord_vision vision/scripts vision/tests
vision/.venv/bin/python -m mypy --strict --follow-untyped-imports vision/smartbord_vision
vision/.venv/bin/python -B -m pytest -c vision/pyproject.toml -q
vision/.venv/bin/python -B vision/scripts/verify_memory.py
```

The complete suite requires explicitly prepared assets and does not silently skip real-model cases. For algorithm-only work before setup, select `-m 'not real_model'`; that excludes real inference/privacy evidence and must be reported separately.

Verification constructs synthetic boards in memory. The real positive test uses only the checksum-pinned public photograph. The I/O guard rejects Python write/network/subprocess/SQLite events and common OpenCV file-output APIs during success/error/close checks, and checks an isolated temporary directory. It is application-level evidence, not an OS syscall, swap, core-dump, proxy or backup audit. No phone image is needed or exported.
