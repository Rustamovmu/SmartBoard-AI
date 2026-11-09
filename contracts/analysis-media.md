# Native measurement bridge — protocol version 2

Implemented on 2026-11-09; see [dated verification](../docs/Analysis_media_verification.md). This adds authenticated, bounded JPEG measurement to the existing native connection foundation. It returns actual rectified/enhanced frames and measurements; it does not decide or save captures. The [V1 connection contract](analysis-transport.md) remains unchanged for `{}` grants, and control sockets remain command-only.

Protocol version 3 reuses this bounded worker path and adds the separate [mounted-camera candidate/acknowledgment lifecycle](analysis-decision-v3.md). Version 2 behavior and result bytes remain unchanged.

## Configuration and startup

- `ANALYSIS_TRANSPORT_ENABLED` and `ANALYSIS_MEDIA_ENABLED` accept exactly `true` or `false`, default to `false`, and media cannot be enabled unless transport is enabled. Both must be explicitly enabled in a verification host.
- `VISION_PYTHON_EXECUTABLE` optionally selects an absolute, operator-configured Python executable. Its default is `vision/.venv/bin/python` under the backend checkout. Clients cannot select a path, command, URL or model.
- Only HTTP application startup starts up to two persistent Python workers. CLI/operator Nest application contexts do not start workers. A worker must load the prepared local model and report ready before protocol-2 grants are issued.
- The host must use one process. Worker slots, socket state and tickets are process-local. This does not certify proxy/TLS, OS swap, core dumps outside worker settings, allocator zeroization, or deployment-wide retention.

## Version-2 grant

Send the existing native-authenticated `POST /analysis/access` with exactly:

```json
{"protocolVersion":2}
```

The body is strict; `{}` continues to issue the original protocol-version-1 grant with capabilities false. Version 2 requires the same active enrolled native session, prepared authentication/enrollment indexes, rate budgets and ticket rules. A missing/unready worker returns 503 `VISION_UNAVAILABLE`; capacity and identity errors use the existing stable contract. Success is HTTP 201, `Cache-Control: no-store`, no cookies, and contains separate one-use `/ws/analyze` and `/ws/control` tickets plus:

```json
{"protocolVersion":2,"capabilities":{"vision":true,"acceptsFrames":true,"automaticCapture":false}}
```

`vision: true` means a worker is ready at grant time. If all workers subsequently fail, the stream closes or reports `VISION_UNAVAILABLE`; grants are not silently upgraded or replayed. Version-2 ready/status envelopes keep `automaticCapture: false`. Control endpoint capabilities set `acceptsFrames: false`.

## Frame request

Connect with the endpoint ticket in `Authorization: Bearer <ticket>` on `/ws/analyze`; native client header and all other V1 upgrade restrictions remain. No credential belongs in a URL. Send one binary WebSocket message per frame:

```text
4-byte unsigned big-endian UTF-8 JSON header length
strict JSON header (1–8,192 bytes)
the exact JPEG bytes
```

The header has exactly eight keys:

```json
{"protocolVersion":2,"type":"frame","streamId":"<assigned UUID>","frameId":1,"sourceTimeMs":1234,"width":320,"height":240,"corners":[[0,0],[1,0],[1,1],[0,1]]}
```

`frameId` is a positive, strictly increasing safe integer for the socket; `sourceTimeMs` is finite, from 0 through 1e12, and nondecreasing. Width/height are integers 32–8,192 and total at most 16,000,000 pixels. Corners are four finite normalized pairs forming a convex clockwise polygon with minimum area/edge bounds. JPEG size is 4–2,000,000 bytes, and its SOF dimensions must match the header. Python independently probes, validates and decodes it. There are no account IDs, lecture IDs/titles, notes, OCR, paths, candidate IDs or save acknowledgments in the frame request.

Only one frame can be in flight per analysis socket; no input-frame backlog is accepted. Admission reserves one of two global worker slots before asynchronous identity checks. A third competing frame receives `ANALYSIS_BUSY` and closes with 1013. The five-message/second limit applies to binary frames and text commands together. Valid heartbeat/status/close text messages remain at most 8,192 bytes while a frame is running.

## Result envelope

One binary server message uses the same length-prefixed structure. The JSON header is at most 32,768 bytes and has exactly:

```json
{"protocolVersion":2,"type":"result","streamId":"<assigned UUID>","frameId":1,"sourceTimeMs":1234,"rectifiedBytes":123,"enhancedBytes":124,"measurements":{}}
```

The exact rectified JPEG follows, then the exact enhanced JPEG. Each is 1–2,000,000 bytes. Measurements include source/corner/output dimensions, bounded quality values and coded concerns, current person boxes/confidence/inference status, overlap and visibility. Unknown or nonfinite fields are rejected. Unavailable inference must be `visibility: "unknown"` and null overlap. Every result is fixed to `tracking: "unverified"` and `automatic_capture_eligible: false`; the bridge creates no baseline, candidate, cooldown, stability/change decision or save-ack state. Returned image/measurement data is transient and is never logged or persisted by this service.

The per-socket outbound budget is 4,049,156 bytes including WebSocket-queued bytes. Capacity is checked before sending. A slow consumer is closed rather than queued without bound. The worker lease stays reserved through the WebSocket send callback, so the two process slots also bound completed-but-undelivered output.

## Worker, authorization and cleanup

Each worker is spawned with an absolute configured executable, `shell: false`, isolated Python (`-I -B -u`), a sanitized environment, no inherited application credentials, piped stdin/stdout and discarded stderr. The private process protocol is separately versioned and receives only request UUID, dimensions, corners and JPEG length/body; it receives no account/session/token/stream identity. It returns strict bounded metadata and two JPEGs. Protocol diagnostics and native stderr are not forwarded or logged.

Worker startup is bounded to 20 seconds. At most two physical workers exist, including a process being killed but not yet closed. A runtime failure, cancellation or 10-second total job deadline kills the worker; a replacement waits for process close plus a one-second backoff. No waiting job queue or restart loop is created. Shutdown cancels active work, kills workers, waits for their close events, wipes owned transfer buffers and clears replacement timers.

For each frame, the stream's current read-only account/session/device binding is checked before worker dispatch and again before result send, with abort-aware two-second validation bounds. The existing once-per-second shared stream revalidation remains active. A check timeout, database outage, logout, reset, account change, device revocation, absolute expiry, analysis socket disconnect or application shutdown cancels the in-flight worker. Normal refresh rotation does not extend the stream's original access/session expiry. Revocation is polling-based, not instantaneous; see the V1 connection contract for the timing bound.

Malformed/unknown/duplicate-key envelopes and frame validation failures close with 1008 `VALIDATION_ERROR`; authorization loss closes with 1008; busy work closes with 1013; worker/job failure closes with 1011 `VISION_UNAVAILABLE`. WebSocket parser payload overflow closes with 1009 and may not include an application envelope. Control sockets reject binary input with 1003. No lecture collection, filesystem writer, object store, persistent queue, browser socket or mobile upload path is added.

## Disposable verification

Run `npm run test:integration -- --runTestsByPath test/analysis-media.integration-spec.ts --runInBand` with only dedicated `MONGODB_TEST_URI` configured. The suite creates a generated `sbt_<32 hex>` database, verifies it is empty, prepares synthetic enrolled sessions and enables both flags only in the test provider. It starts a random loopback HTTP/WebSocket host and two real local workers, uses generated in-memory synthetic JPEGs, removes only the exact owned database after cleanup, closes sockets/app/processes, and wipes retained fixture image/result buffers. Never submit lecture images or real application credentials to this harness.
