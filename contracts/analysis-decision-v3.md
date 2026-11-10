# Mounted-camera decision lifecycle — protocol version 3

Implemented on 2026-11-09 as a default-off extension of the [native connection foundation](analysis-transport.md) and [measurement bridge](analysis-media.md). The phone still owns every durable image, catalog entry and accepted baseline. Version 3 retains only bounded frame/result/signature/candidate buffers in process RAM. It does not add a MongoDB collection, filesystem path, job queue, automatic camera capture, mobile client, or handheld tracker.

## Grant and capabilities

With `ANALYSIS_TRANSPORT_ENABLED=true` and `ANALYSIS_MEDIA_ENABLED=true`, a prepared host can issue a protocol-3 grant to an active enrolled native session:

```http
POST /analysis/access
X-SmartBord-Client: native
Authorization: Bearer <native access token>
Content-Type: application/json
```

```json
{"protocolVersion":3}
```

Success is HTTP 201 with `Cache-Control: no-store`, separate one-use endpoint tickets and capabilities:

```json
{"protocolVersion":3,"capabilities":{"vision":true,"acceptsFrames":true,"captureCandidates":true,"automaticCapture":false}}
```

If the media worker is disabled or not ready, grant issuance returns 503 `VISION_UNAVAILABLE` before reserving a stream or issuing endpoint tickets. Versions 2 and 3 share this readiness check; version 1 remains available with vision disabled. The grants and session/device binding have the same rate, capacity, expiry, revocation and exact-path rules as version 1. Version 1 `{}` and version 2 `{"protocolVersion":2}` remain compatible. The control socket always advertises `acceptsFrames:false` and stays text-command-only.

## Baseline and frame input

Connect to `/ws/analyze` with the protocol-3 analyze ticket. Each binary message uses the version-2 length prefix: four-byte unsigned big-endian JSON-header length, strict UTF-8 JSON header, then the exact JPEG. A version-3 header has exactly these fields:

```json
{"protocolVersion":3,"type":"baseline","streamId":"<assigned UUID>","frameId":1,"sourceTimeMs":100,"width":320,"height":240,"corners":[[0,0],[1,0],[1,1],[0,1]],"captureMode":"mounted"}
```

`type` is `baseline` or `frame`; all other version-2 geometry, frame ID, timestamp, JPEG SOF and size bounds apply. `captureMode` must be `mounted`. Handheld requests are rejected; there is no tracking/homography-confidence implementation in this increment. The first baseline frame is transiently analyzed and reduced to a 48×32 rectified-grayscale signature plus supplied corners. The signature is 1,536 bytes and never returned or persisted. A stream accepts exactly one baseline. Until it is accepted, normal frames return `baseline_required` without running the worker.

The phone must supply the image corresponding to its last locally accepted baseline after a new stream is authorized. A baseline sent before the phone has a durable accepted image must not be treated as proof of a saved capture. On successful analysis the socket sends a version-3 `status` envelope with `state:"baseline_accepted"`.

## Decision gates

Each frame receives fresh quality/person measurements from the CPU worker. Candidate eligibility requires:

- normalized source corners within 0.01 maximum per-axis drift from the accepted mounted corners;
- `focus_uncertain:false`, no coded quality concerns, sharpness at least 25 and brightness from 45 through 245;
- person inference `available`, `visibility:"no_detected_obstruction"` and overlap exactly zero;
- at least 2.5% of signature pixels changing by 16 or more grayscale levels and mean absolute difference at least 3.5 from the phone baseline;
- a further two seconds of stable signatures (at most 1.5% pixels changing by 16 or more and mean difference at most 2.5 between observations).

These are initial deterministic heuristics, not validated classroom thresholds. They operate on rectified, low-resolution grayscale signatures. The gate reports `tracking_uncertain` on corner drift and does not claim that mounted corners verify a real camera mount. It reports `quality_rejected`, `obstructed`, `unchanged`, `stabilizing` or `cooldown` when those gates apply. It does not add temporal person tracking, duplicate visual semantics, calibrated camera tracking, or an automatic sampling loop. `automaticCapture` stays false.

After a candidate's save acknowledgment, a three-second cooldown delays another candidate. A meaningful change that fails a gate does not advance the accepted signature. The baseline advances only after a matching active candidate acknowledgment.

## Candidate, retry and acknowledgment

A candidate is a binary response with the same four-byte header-length prefix, a strict JSON header, then exact rectified JPEG bytes and enhanced JPEG bytes:

```json
{"protocolVersion":3,"type":"candidate","streamId":"<assigned UUID>","candidateId":"<UUID>","frameId":3,"sourceTimeMs":300,"expiresAt":"2026-11-09T00:00:30.000Z","rectifiedBytes":123,"enhancedBytes":124,"measurements":{}}
```

The candidate is a suggestion only. It does not mean the phone saved anything. At most two complete pending candidates are retained globally per process; each expires after 30 seconds. Candidate bytes and signature are wiped on acknowledgment, expiry, stream close/revocation and application shutdown. A slow consumer is closed at the existing per-socket outbound budget.

To request the still-pending candidate again on the analyze socket, send a strict text envelope:

```json
{"protocolVersion":3,"streamId":"<assigned UUID>","type":"candidateRequest","candidateId":"<UUID>"}
```

After the phone has durably committed the candidate image and catalog entry, it can send:

```json
{"protocolVersion":3,"streamId":"<assigned UUID>","type":"localSaveAcknowledged","candidateId":"<UUID>","saveRequestId":"<UUID>"}
```

The acknowledgment must match the currently pending candidate. A stale/unknown ID returns `STALE_CANDIDATE` and cannot advance state. An exact duplicate `(candidateId, saveRequestId)` returns `candidate_saved` with `repeated:true`; first acceptance returns `repeated:false`. The stream keeps only the most recent 64 accepted candidate/save-request pairs for idempotent retries, including after later candidates are accepted; older pairs become stale. This bounded history exists only in stream RAM and is cleared on disconnect/revocation/shutdown. No local save operation exists in this backend; the phone must send no success acknowledgment after a local save failure.

Version-3 frames and candidate commands count toward the five-application-messages-per-second socket limit. One frame may be in flight and no input backlog is accepted. Existing worker, message, frame, output, idle, identity-poll and close-grace bounds apply. Binary input to control is rejected; candidate lifecycle commands on control are rejected. Unknown fields, wrong versions/stream IDs, malformed commands and malformed frame headers close with 1008 `VALIDATION_ERROR`; oversized messages close with 1009; busy/outbound overflow closes with 1013 `ANALYSIS_BUSY`; worker failure closes with 1011 `VISION_UNAVAILABLE`.

## Verification and remaining work

`test/analysis-media.integration-spec.ts` exercises the grant and both real loopback sockets against an exact guarded disposable MongoDB database and actual local Python workers. The V3 case sends a synthetic baseline, waits for stable changed frames, receives/retries real JPEG candidates, rejects a stale acknowledgment, confirms an unchanged frame does not generate a candidate, accepts a later candidate and retries the earlier acknowledgment. It does not certify physical camera accuracy, phone-side persistence/recovery, handheld tracking, browser sockets, production TLS/proxy behavior, multiple server instances, or deployment-wide memory/swap/log retention.

The feature remains disabled by default. The separate Android [client foundation](../../SmartBord-AI-frontend/docs/Connected_analysis.md) now implements secure-session integration, explicit mounted-frame disclosure/setup, local source/derived bundle save/recovery and post-commit acknowledgment. Its synthetic/native-build evidence does not establish physical camera, WSS or phone file/database atomicity. Verify the combined physical path before acceptance, and separately add a verified handheld tracking mode if needed. Reconnection must use the durable source original and its source corners, not an already-rectified candidate.
