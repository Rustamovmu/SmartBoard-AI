# Connected analysis lifecycle — version 1

Status: lifecycle requirements only. No WebSocket gateway, binary framing codec or worker exists in B1. Exact wire schemas and executable validation must be added with B3/B4 before any frontend uses analysis. Do not generate client types from imagined GraphQL/media operations.

The [V1 constants](../src/contracts/platform-v1.ts) and both [backend](../docs/Backend_plan.md) and [frontend](../docs/Frontend_plan.md) plans govern this contract. Breaking wire changes require a protocol-version change and coordinated frontend update.

## Access and data boundaries

- `POST /analysis/access` will issue a short-lived stream-scoped permission after current account/device checks. No lecture record is created.
- `/ws/analyze` will carry authenticated transient analysis. Credentials must not appear in query strings. Browser/native handshakes must be specified and tested with access revocation before implementation is accepted.
- `/ws/control` will carry enrollment/account status, with no private lecture feed.
- Messages use `protocolVersion`, an ephemeral `streamId`, `frameId`, `candidateId` when applicable, dimensions and source/monotonic timestamps. Wall-clock platform timestamps are ISO UTC and distinct from source-video times.
- Never send local titles, notes, OCR catalog, permanent lecture IDs, local paths, full video or audio. Only selected compressed JPEG frames and the permitted reconnect baseline/calibration data may reach analysis in RAM.

## Required limits

Maximum compressed JPEG size is 2,000,000 bytes (decimal 2 MB); maximum decoded image size is 16,000,000 pixels. Verify decoded dimensions before costly processing and reject malformed input. Only one frame may be in flight per stream. No backlog or disk queue is allowed; apply backpressure and skip automatic sampling opportunities under load. The phone retains one pending explicit capture action.

Initial targets are five samples/second, two seconds of stability and a three-second capture interval. These are future processing targets, not measured B1 performance. Candidate and session memory budgets, maximum concurrent streams, result-byte limits and handshake/grant expiry must be quantified and tested before enabling B4. Inactivity timeout is 30 seconds.

## Candidate/local-save acknowledgment

1. The phone creates a durable local destination before analysis begins and owns the current accepted baseline.
2. The worker receives a bounded frame and validates calibration/tracking, quality, stability, fresh person inference, meaningful change and duplicate protection. Missing AI means unknown/degraded visibility. Uncertain tracking suppresses automatic capture.
3. A candidate response contains a unique candidate ID, source-frame identity, actual calculated measurements and actual rectified/enhanced bytes. It means a result is available, not that anything has been saved.
4. The phone stages/finalizes durable files and commits its catalog under a unique save-request/candidate key. It shows a saved message only after the local commit succeeds.
5. Only then does the phone send `localSaveAcknowledged` for that candidate. The worker advances its comparison baseline exactly once after matching an active candidate. Unknown, mismatched, stale or out-of-order acknowledgments must not advance it.
6. Duplicate candidates resolve to the existing local save. Duplicate acknowledgments are idempotent while bounded stream state is alive. Do not add a persistent backend idempotency archive.
7. If saving fails, the phone reports a local error and sends no success acknowledgment. The worker never advances its accepted baseline or persists a rescue copy. A cooldown delays a pending meaningful change; it must not silently consume it.
8. Disconnect, revocation, logout, grant expiry or 30 seconds of inactivity clears transient buffers. A worker restart loses stream state. Reconnect uses a new permission/stream; the phone may resend its accepted baseline in RAM after permission, and the worker resets temporal stability. A late acknowledgment from the old stream cannot mutate the new stream.

RAM-only processing still transmits selected frames. Users who decline transmission retain local/manual capture; zero-transmission AI requires a separate on-device implementation. No such implementation is claimed here.
