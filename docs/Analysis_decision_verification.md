# Mounted-camera decision lifecycle verification

## 2026-11-09 — Native protocol version 3

Added opt-in protocol version 3 to the existing authenticated native media bridge. The feature requires both `ANALYSIS_TRANSPORT_ENABLED=true` and `ANALYSIS_MEDIA_ENABLED=true`; defaults remain false. V1 `{}` grants and V2 `{"protocolVersion":2}` measurement responses remain supported. No production/local `.env`, application database, schema, GraphQL operation, admin account, mobile/website source, or deployment changed.

The phone supplies its accepted baseline frame per stream. The bridge derives a 48×32 grayscale signature from the worker's rectified board, holds it in a mutable 1,536-byte buffer and clears it after returning the bounded response. Fixed mounted-corner drift, measured quality, fresh person inference with no detected obstruction, meaningful change and two-second signature stability gate candidates. Candidate packets carry the actual rectified/enhanced JPEGs and measurements; at most two are retained process-wide for 30 seconds and a client can request the same packet again. The in-memory baseline advances only for the matching active candidate ID and `saveRequestId`. The latest 64 candidate/save-request pairs remain idempotent in stream memory; older acknowledgments are stale. Control sockets reject candidate commands and remain text-only. All exact headers, response/error envelopes, bounds and decision thresholds are documented in the [V3 contract](../contracts/analysis-decision-v3.md).

### Validation

- `npm run lint` — passed.
- `./node_modules/.bin/tsc --noEmit --incremental false` — passed.
- `npm test -- --runInBand` — 21 suites / 131 tests passed.
- `npm run test:e2e -- --runInBand` — 2 suites / 20 tests passed. The initial sandbox attempt was denied permission to bind loopback (`EPERM`) and started no host; rerun outside the sandbox passed.
- `npm run test:integration -- --runTestsByPath test/analysis-media.integration-spec.ts` — 1 suite / 20 tests passed against an initially empty, exact-name disposable MongoDB database with a random loopback host and actual local Python workers. The V3 test covers grant capabilities, control-channel rejection, baseline acceptance, changed/stable frames, actual JPEG candidate bytes/lengths, retry with identical candidate bytes, stale-ack rejection, duplicate acknowledgment after a later candidate, and suppression against the acknowledged baseline. The suite stopped its host/workers, closed connections/sockets and removed only the exact guarded database.
- `npm run postman:test` — 83 requests / 322 assertions passed; zero failures. The usual Postman cloud-login notice appeared; no run was published. Its host stopped and exact disposable database was removed.
- `npm run build` — passed.
- `npm run schema:generate` — passed; `contracts/schema.graphql` remained unchanged.
- From `vision/`: Ruff check, Ruff format check, strict Mypy and Pytest — passed; 55 tests.
- `git diff --check` — passed before final documentation edits; rerun with staged-content review before commit.

The initial sandbox database connection failure for the real integration suite was rerun outside the sandbox and passed. A later sandbox-only HTTP loopback bind attempt failed with `EPERM`; the authorized outside-sandbox run passed. These failed attempts are not counted as passing checks.

### Scope and remaining work

No phone-side file/catalog save or recovery was implemented, so the server's `candidate_saved` response is only a protocol acknowledgment and does not prove local persistence. The client must send it only after a durable local commit. There is no handheld tracker, physical phone-camera/classroom accuracy result, temporal person tracking, automatic sampling/capture loop, browser socket, production TLS/proxy review, multi-instance routing or deployment-wide memory/swap/log/backup audit. The fixed-corner and image-signature thresholds are initial deterministic heuristics, not validated capture-quality standards. Protocol 3 remains disabled by default. No lecture content is stored in MongoDB or written to server files/queues by this increment.
