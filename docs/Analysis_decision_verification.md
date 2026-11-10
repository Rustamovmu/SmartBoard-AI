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

## 2026-11-10 — Media grant readiness correction

Mobile protocol review found that the access service checked media enablement/readiness only for version 2. A version-3 request could therefore receive HTTP 201 and vision-enabled capabilities while media was disabled or unready, contrary to the decision contract. Versions 2 and 3 now share the readiness check before stream reservation/ticket issuance; either condition returns HTTP 503 `VISION_UNAVAILABLE`. Version-1 grants remain available with vision disabled.

The existing guarded HTTP integration case now runs for both media versions, checks the disabled flag and unavailable-worker paths, and confirms a ready worker subsequently permits a grant on the same device. The pre-fix outside-sandbox run reproduced the version-3 defect (expected 503, received 201) while version 2 passed. After the correction, the full `test/analysis-media.integration-spec.ts` suite passed all 21 tests with its exact-name disposable MongoDB fixture, random loopback host and actual local Python workers. The fixture closed its sockets/host/workers and dropped only its guarded database. The initial sandbox attempt could not connect to the dedicated test database and is not counted as a pass. Expected negative-path logs contained only fixed HTTP 503 diagnostics.

`npm run lint`, non-writing `./node_modules/.bin/tsc --noEmit --incremental false`, `npm run build`, and `git diff --check` passed. Changed paths are the analysis access service, media integration test, V3 contract and this record. No application records, GraphQL schema, collection/index, local environment setting, deployment, or media persistence path changed. Physical mobile capture and storage behavior remain outside this regression evidence.

### Broader regression and mobile handoff

Backend unit tests passed 21 suites / 131 cases, and HTTP tests passed 2 suites / 20 cases. The full MongoDB integration run finished with 10 suites passing and 179/184 cases passing; five cases in the existing username suite failed during MongoDB monitor/network timeouts. No test timeout or database settings were relaxed. A read-only ping of the dedicated test URI then succeeded, and the entire username suite passed on a fresh guarded disposable database (12/12 cases, 21.9 seconds). Thus all integration cases were exercised successfully across the broad run and targeted retry; the initial full invocation itself is not recorded as a clean pass. The test-owned fixtures closed their hosts/connections and performed guarded cleanup.

Postman CLI passed 83 requests / 322 assertions with zero failures, stopped its temporary host and removed its exact disposable database. The usual cloud-login notice appeared; no run was published. Schema generation passed and `contracts/schema.graphql` remained byte-unchanged. The separate Android client foundation is committed as `1d86c9b` in the mobile repository, with 69 synthetic/mocked tests, browser CSP/privacy checks, local bundle recovery/SQLite rollback evidence and Android assembly/lint. See its [connection/persistence contract](../../SmartBord-AI-frontend/docs/Connected_analysis.md) and [dated evidence](../../SmartBord-AI-frontend/docs/Verification.md). These checks do not establish combined physical phone camera/WSS/save/cold-restart acceptance; iOS live sampling and production retention remain pending.
