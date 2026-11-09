# Standalone frame worker — first B4 increment

Implemented 2026-11-09 under `vision/`; see [setup](../vision/README.md) and [dated evidence](../docs/Vision_worker_verification.md). This is an internal synchronous Python interface. It adds no public API, HTTP service, socket frame codec, GraphQL operation, database collection or application setting. [Native transport](analysis-transport.md) remains default-off and rejects media. [Candidate/acknowledgment lifecycle](live-protocol.md) remains future work.

## Input and bounds

`FrameWorker.process(jpeg: bytes, width: int, height: int, corners: Corners) -> FrameResult` accepts one immutable JPEG byte string, exact encoded dimensions and confirmed source geometry. It does not accept or fetch a path/URL. No local lecture ID/title/note/OCR/file reference is part of the interface.

- Compressed JPEG: 4–2,000,000 bytes, SOI/EOI markers required; supported RGB/grayscale JPEG only.
- Declared axes: integer 32–8,192 pixels, excluding booleans; at most 16,000,000 decoded pixels.
- Pillow probes format/mode/dimensions before OpenCV decode; decoded shape must agree. EXIF rotation is ignored so all coordinates refer to the encoded, unmirrored source. This is not an exhaustive entropy-stream validator; the JPEG decoder can tolerate some recoverable damage. No damaged/accepted frame can become an automatic capture in this increment.
- Calibration: four finite normalized `(x, y)` tuples in a convex clockwise cycle, area at least 2.5% and adjacent normalized distance at least 0.025. The first corner defines output top-left. Crossed, concave, reversed and tiny polygons are rejected, not silently reordered. This validates geometry; it does not detect a board or prove tracking/calibration freshness.
- Rectification: bounded to 960 pixels wide / 1,600 high, never upscaled. Very thin output below 32 pixels on an axis is rejected.
- Returned rectified and enhanced JPEGs: at most 2,000,000 bytes each. They are distinct derived copies; the immutable input is not overwritten.
- One in-flight call per worker, with immediate `ANALYSIS_BUSY` on concurrent process/close and no pending queue. Closed workers reject further processing.

Validation failures use fixed `VisionError`/`VALIDATION_ERROR`; unexpected processing or closed-worker failures use fixed `VisionProcessingError`/`VISION_UNAVAILABLE`. Errors never interpolate input, paths or native exception messages. This Python core does not define future HTTP statuses or wire envelopes.

## Measurements and output semantics

`FrameResult` carries source/output dimensions, validated corners, the two JPEG byte strings, `Quality`, `PersonResult`, nullable `person_box_overlap_fraction` and visibility. Byte fields are excluded from default result repr. None of these private derived measurements belongs in server logs, content telemetry or durable records.

Quality uses actual Laplacian variance, mean brightness, dark/highlight fractions and a local-background/color ink mask. It returns coded concerns for darkness, possible blur, clipped/textureless content and unknown focus. Thresholds are appearance heuristics adapted from the inspected legacy implementation, not camera-independent accuracy guarantees or semantic confidence. Mild CLAHE enhancement is separate from the rectified source.

Every successful available person result comes from a fresh CPU inference on the current source frame. YOLO11n COCO class zero is selected from the highest-scoring class; confidence threshold is 0.35. Letterboxing uses 640×640 with padding 114, RGB float input scaled by 1/255. Output must be finite `[1,84,8400]`. Pre-NMS selection is capped at 300, IoU suppression uses 0.45 and results are capped at 100 people. Boxes and actual confidences use normalized source coordinates.

The overlap measurement rasterizes the union of person boxes against the actual calibrated polygon on a mask capped at 640 on either axis. It is a conservative bounding-box estimate, not person segmentation. Stationary people still contribute. Boxes outside the board do not contribute and duplicates are not double-counted.

Unavailable/invalid/missing models or failed inference produce `status: unavailable`, empty boxes, no inference time, **null overlap and unknown visibility**. They never imply zero obstruction. Available inference with no overlapping boxes says `no_detected_obstruction`, not confidently clear; overlapping boxes say `detected_obstruction`.

All results have `tracking: unverified` and `automatic_capture_eligible: false`. No motion, elapsed stability, content comparison, duplicate protection, cooldown, candidate ID, accepted baseline or local-save acknowledgment exists here. Returned image bytes establish neither a capture decision nor a phone-local save.

## Model, memory and side effects

The runtime loads a checksum-verified local ONNX model once per detector, explicitly chooses OpenCV CPU, disables OpenCL and uses two OpenCV threads. Its dependencies contain no Ultralytics/PyTorch SDK or network client. It has no automatic downloader, directory creator, frame writer, output cache, database or worker queue.

OpenCV Net retains its input/activations. After each actual inference the adapter zeros its own arrays and runs a neutral zero-input forward pass, overwriting retained network state before returning. Cleanup failure discards the network and marks the result unavailable. This costs an additional forward pass and is included in overall worker wall time; reported `inference_ms` measures the actual person pass/postprocessing before neutral cleanup. This does not establish physical memory zeroization of allocators or OS pages.

The worker zeros owned source/rectified/enhanced pixel arrays on success and failure, and retains only its detector/lock/closed state. Returned immutable JPEGs and the input bytes are caller-owned; callers must release them and must not retain errors/results in logs or disk queues. Closing releases the detector. No server comparison baseline advances because no baseline exists yet.

Resource bounds cover frame pixels, transformed outputs, static 640 model tensors, fixed output predictions and bounded box lists. There is no tested hard RSS/OS-memory ceiling and no five-frames/second acceptance claim. The synchronous core has no hard inference timeout or interrupt/revocation hook. A future isolated-process bridge must bound those, discard late results and audit cancellation/retention before enabling media on existing authenticated sockets.

## Provenance and verification

Reviewed model/source/checksums/export profile: [model lock](../vision/model-lock.json). Reviewed positive fixture: [fixture lock](../vision/test-fixture-lock.json). Only explicit preparation downloads the official model and public photograph; runtime never contacts those sources. Weights/config/public test assets are allowed local caches and are ignored by Git. The model remains subject to its upstream license; exporting it does not alter those terms.

Primary references: [OpenCV DNN preprocessing/export/postprocessing](https://docs.opencv.org/4.x/da/d9d/tutorial_dnn_yolo.html), [YOLO11 models](https://docs.ultralytics.com/models/yolo11/), [official model release](https://github.com/ultralytics/assets/releases/tag/v8.3.0), [official model card](https://huggingface.co/Ultralytics/YOLO11), [Pillow image probing](https://pillow.readthedocs.io/en/stable/reference/Image.html), [upstream model licensing](https://www.ultralytics.com/license).

The dated verification distinguishes controlled geometry/prediction tensors, real public-image person inference and guarded synthetic worker execution. None establishes physical classroom tracking/occlusion accuracy, native phone integration or deployment-wide no-retention. No actual application account, MongoDB record or private phone file is involved.
