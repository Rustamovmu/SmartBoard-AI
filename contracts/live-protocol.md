# Connected analysis lifecycle — version 3

Status: the default-off [native connection foundation](analysis-transport.md), [version-2 measurement bridge](analysis-media.md), and [version-3 mounted-camera decision lifecycle](analysis-decision-v3.md) are implemented. Version 3 can return transient candidates and advance its in-memory comparison baseline only after a matching acknowledgment. It does not implement phone-side durable saving, handheld tracking or production deployment validation. Do not generate client types from imagined GraphQL/media operations.

The [V1 constants](../src/contracts/platform-v1.ts) and both [backend](../docs/Backend_plan.md) and [frontend](../docs/Frontend_plan.md) plans govern this contract. Breaking wire changes require a protocol-version change and coordinated frontend update.

## Access and data boundaries

- `POST /analysis/access` now issues endpoint-specific one-use tickets for an enrolled native session when explicitly enabled. No lecture record is created.
- `/ws/analyze` carries authenticated transient analysis for version 2 and mounted-camera decision frames for version 3. Credentials must not appear in query strings. The native-only ticket handshake is specified in the connection contract; browser sockets remain unsupported.
- `/ws/control` will carry enrollment/account status, with no private lecture feed.
- Messages use `protocolVersion`, an ephemeral `streamId`, `frameId`, `candidateId` when applicable, dimensions and source/monotonic timestamps. Wall-clock platform timestamps are ISO UTC and distinct from source-video times.
- Never send local titles, notes, OCR catalog, permanent lecture IDs, local paths, full video or audio. Only selected compressed JPEG frames and the permitted reconnect baseline/calibration data may reach analysis in RAM.

## Required limits

Version 2/3 enforce a 2,000,000-byte JPEG limit, 16,000,000 decoded pixels, one frame in flight per analysis socket, no input backlog, bounded worker/output slots and an 8 KiB control-message limit. See their contracts for exact bounds. No disk queue is allowed; apply backpressure and skip sampling opportunities under load. The phone retains one pending explicit capture action.

The implemented version-3 decision uses a two-second stability interval and three-second post-ack cooldown; it does not set a client sampling cadence or authorize autonomous capture. Candidate and session memory budgets, maximum concurrent streams, result-byte limits and grant expiry are bounded and described in the versioned contracts. Inactivity timeout is 30 seconds.

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
