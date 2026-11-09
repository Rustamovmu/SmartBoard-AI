# Native media bridge verification

## 2026-11-09 — Authenticated protocol-version-2 measurement bridge

Implemented the default-off Nest-to-Python bridge defined in [the media contract](../contracts/analysis-media.md). `/analysis/access` still issues its original V1 grant for `{}`; an exact `{ "protocolVersion": 2 }` body opts into V2 only when both transport/media flags are explicitly true and at least one real worker is ready. The protocol-version-2 `/ws/analyze` path accepts bounded binary frame envelopes. `/ws/control` and all V1 sockets remain command-only. Responses contain actual rectified/enhanced JPEG bytes and validated quality/person/visibility measurements; tracking is `unverified` and automatic capture is false.

The implementation uses two persistent CPU-only Python subprocess slots, private length-prefixed stdio, sanitized child environment, strict duplicate-key/header/measurement validation, two binding checks around inference, one frame per socket, no backlog, a 10-second total job deadline, cancellation by worker termination and a bounded send callback/queue. Tickets, buffers, worker state and sockets remain transient. No frame collection, image/file writer, persistent queue, capture candidate/save acknowledgment or lecture metadata was added. The flags default off; this task did not change ignored local `.env` or production settings.

### Commands and results

- `npm run lint` — passed.
- `./node_modules/.bin/tsc --noEmit --incremental false` — passed.
- `npm test -- --runInBand` — 20 suites / 124 tests passed.
- `npm run test:e2e -- --runInBand` — 2 suites / 20 tests passed after rerunning outside the restricted loopback sandbox. The first sandbox attempt was denied listener creation with `EPERM` and started no host.
- `npm run test:integration -- --runTestsByPath test/analysis-media.integration-spec.ts --runInBand` — 1 suite / 19 cases passed against an initially empty, exact-name disposable MongoDB database and a random loopback host. Real local worker processes returned decodable derived JPEG output. Cases include V1 compatibility, V2 readiness/ownership, malformed/duplicate/oversized inputs, serialization limits, actual results, concurrent socket/message behavior, two-worker global bound, cancellation, logout, single/bulk device revocation, password reset, blocking/role changes, and worker shutdown.
- `npm run test:integration` — 11 suites / 182 tests passed. Expected negative-path HTTP 503 logging occurred; no test failed.
- `npm run postman:test` — 83 requests / 322 assertions passed. The local CLI emitted its usual informational notice that cloud publishing needs Postman login; it published no run. The test host stopped and its exact disposable database was removed.
- `npm run build` — passed.
- `npm run schema:generate` — passed; the generated GraphQL artifact is unchanged (`contracts/schema.graphql`).
- From `vision/`: `./.venv/bin/python -B -m ruff check smartbord_vision scripts tests` — passed.
- From `vision/`: `./.venv/bin/python -B -m ruff format --check smartbord_vision scripts tests` — passed.
- From `vision/`: `./.venv/bin/python -B -m mypy --strict --follow-untyped-imports smartbord_vision` — passed.
- From `vision/`: `./.venv/bin/python -B -m pytest -c pyproject.toml -q` — 55 tests passed, including strict private pipe framing and the existing prepared real-model/guarded I/O cases.

The tests used generated synthetic in-memory JPEGs, synthetic enrolled accounts and exact disposable database names. They do not certify device camera accuracy, physical phone behavior, frontend consumption, inference throughput, hard RSS limits, allocator/OS-page zeroization, proxy buffering, deployment-wide retention, TLS/proxy configuration or multi-instance routing. The media pipeline is not production-enabled. Native secure storage/UI, tracking/stability/change decisions and phone-local save acknowledgment remain future work.
