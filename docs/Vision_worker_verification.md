# Standalone CPU frame verification — 2026-11-09

First B4 milestone only: a real synthetic frame is decoded, measured and rectified in RAM, with fresh real CPU person inference and no application frame persistence. [Contract](../contracts/vision-worker.md), [setup/commands](../vision/README.md). Nest media acceptance, worker-process bridge, tracking/decision state and candidate/save acknowledgments remain inactive.

## Source and environment

Started from clean `develop` at `f80775f`. Inspected the backend/frontend plans, README/scripts/current contracts and dated progress; the new native connection services remain unchanged. The backend references have no equivalent Python vision implementation. Inspected the actual legacy `backend/app/vision/{geometry,metrics,person_detection}.py`, JPEG decoder, relevant vision tests, model preparation and algorithm/evidence documents under the read-only `../whiteboard detection` project. Adapted geometry/appearance ideas without its filesystem Store, session history, runtime SDK configuration or optional integrations. No reference file, model, user data or virtual environment was modified/copied.

Verified environment: Python 3.11.9, macOS arm64; isolated `vision/.venv` runtime/dev tools and separate ignored `.cache/vision-export-venv` preparation tools. Runtime has pinned headless OpenCV 4.14.0.94, NumPy 2.4.6 and Pillow 12.3.0. Ultralytics/PyTorch are absent from that environment. Complete dev/export locks and source manifests are committed; binary weights, public sample, virtual environments and analysis/lint/test caches are ignored.

## Actual model and frame evidence

Downloaded official YOLO11n from the pinned upstream release URL during explicit preparation. Source SHA-256: `0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`. Exported fixed 640×640 FP32/opset-12 ONNX, removed incidental metadata and recorded derived SHA-256 `7afa50f64e94321661c860675810d1328d7ba6994d27e4fb2614678e78ee9e1a`. A second ordinary preparation succeeded with exactly the same model/fixture hashes and no lock update.

The public positive photograph has SHA-256 `c02019c4979c191eb739ddd944445ef408dad5679acab6fd520ef9d434bfbc63`; its source is in `vision/test-fixture-lock.json`. Genuine local OpenCV-DNN inference found four people on that public image. The repeated real-model regression requires at least two actual boxes with finite normalized coordinates/confidences. Controlled output tensors separately verify letterbox reversal, class selection, NMS and neutral network cleanup. The public photo is a detector execution check, not physical whiteboard/classroom accuracy evidence.

A generated 320×240 synthetic board was processed through the real worker. It returned actual decodable rectified/enhanced JPEG bytes, measured quality and available fresh model inference. Tracking stayed unverified and automatic capture false. Missing-model execution was checked separately and returned unknown visibility/null overlap, never a fake clear result. No generated board or returned image was written to a file or sent to a service.

## Checks and results

- Python suite: **44 passed**, including two `real_model` cases; no skipped/fabricated model result. Source syntax executes under Python 3.11; strict Mypy passes all seven core modules.
- Ruff check/format checks pass for runtime, scripts and tests. Both isolated environments pass `pip check`.
- `verify_memory.py` with the real local model: three synthetic successes, three invalid-frame rejections, zero forbidden I/O events and zero new Python threads. It checks actual returned JPEG decode, closes the worker and leaves its isolated temporary directory empty. stdout is one aggregate JSON result; stderr is empty in its subprocess regression.
- Node baseline checks passed: clean non-fixing lint, non-writing TypeScript, and nineteen unit suites / **115 tests**. The plans retain shared routes/error/pagination contracts. No Node source, GraphQL schema, package manifest/lock or auth/database behavior changed.
- Markdown path/link, task-file diff/whitespace, explicit staged artifact/credential and generated-output checks apply before the focused local commit.

Core cases cover format/header and declared-dimension agreement before native allocation; compressed/pixel/axis limits; orientation coordinates; malformed/truncated-envelope/PNG/CMYK rejection; convexity/order/area/finite-corner validation; known perspective restoration and output limits; blur/dark/clipped/focus-unknown measurements; person polygon union/outside-board overlap and invalid measurements; fresh stationary obstruction checks; detector failure/unknown state; one in-flight frame, immediate busy process/close, error recovery and closed-worker rejection; output size/encode failure and cleared owned buffers; checksum/missing/oversized model rejection; and real positive detection plus guarded synthetic execution.

The I/O guard runs after code/model initialization and before any synthetic frame processing. It rejects Python audit events for write opens, socket/network, subprocess, SQLite and common mutation operations, plus common OpenCV file-output APIs. It verifies success/rejection/close paths and caller-discarded results. This is not a native syscall/packet tracer or an OS/proxy/swap/crash-dump/backup audit. OpenCV native worker threads are controlled by its two-thread setting; the thread-count assertion is specifically for Python threads.

## Initial issues and scope limits

Sandbox dependency requests failed because registry/DNS access was restricted. Required permitted reruns installed the pinned packages; model/fixture downloads were explicit setup only. Initial strict-type checks identified OpenCV overload/dtype and Literal annotations; those were corrected, including explicit `connectivity=8`. Initial lint findings were unused imports and script bootstrap import placement; corrected before final passes. No production inference assertion was weakened.

A test-collection inspection initially expanded a synthetic oversized byte string into its generated test ID. The byte data was nonprivate synthetic `x` content. Short explicit IDs now keep output bounded; pytest's result cache is disabled for this package and the task-created prior node-ID cache was cleared. Final collection lists only short IDs. This was an output-hygiene correction, not evidence of a production image leak.

JPEG probing/decoding is not an exhaustive entropy validator; recoverable decoder damage may still produce pixels. No result becomes an automatic candidate. Quality thresholds are heuristics; person boxes are conservative approximate occlusion, and a detector can miss people/hands. No mounted alignment validation, handheld tracking, motion/stability, change/SSIM/duplicate gating, baseline, cooldown, local-save acknowledgment, hard inference timeout/process cancellation, Android/iPhone integration or real classroom trial is claimed. Full B4/B6 and V2 acceptance are incomplete.

No application DB query/preparation/fixture, administrator bootstrap, actual account/content change, phone capture/catalog access, native app mutation, production deployment or push occurred. No backend/website/mobile server was started; checks were finite local programs and all completed. Ignored model/tool caches intentionally remain for local reuse. Existing user processes were untouched. Existing dependency-advisory and unexpected-empty-collection findings were not re-audited or resolved by this Python-only increment.

## Changed paths

New `vision/` package: `smartbord_vision/{contracts,decoding,geometry,quality,person_detection,worker,__init__}.py`; `tests/{conftest,test_frame_core,test_person_detection,test_memory_boundary}.py`; `scripts/{prepare_model,verify_memory}.py`; `README.md`, `pyproject.toml`, three direct requirements files, two full lock files, `model-lock.json` and `test-fixture-lock.json`.

Existing/root documentation: `.gitignore`, `AGENTS.md`, `README.md`, `contracts/live-protocol.md`, new `contracts/vision-worker.md`, `docs/Backend_plan.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md` and this record. No ignored model/media/venv/cache artifact or credential belongs to the commit.
