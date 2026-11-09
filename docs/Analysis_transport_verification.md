# Native connection verification — 2026-11-09

Scope: [native connection contract](../contracts/analysis-transport.md), default-off access grants and bounded analyze/control sockets. No Python worker, image acceptance, candidate processing, browser sockets, mobile UI, public deployment or application-record change is included.

## Implementation and references

`AnalysisAccessModule` adds a thin HTTP controller, native access policy, read-only identity validator, bounded process-memory registry and native WebSocket transport/peer lifecycle. HTTP authentication exposes existing access/session expiry internally to bind the original stream lifetime; public auth DTOs are unchanged. The safe HTTP filter whitelists the typed capacity exception instead of accepting arbitrary exception payload codes. No schema/index or GraphQL operation changed.

Inspected the TripLink socket gateway/service and Nestar gateway. Their chat lifecycle/module patterns help organize connection ownership, but neither provides device-local storage or transient vision. No reference source was changed, and URL-token authentication, chat history, message logging and business fields were not imported. The `ws` noServer/upgrade/limit options follow its official documentation. Registry values are platform bindings and ticket hashes, without raw account credentials, lecture metadata or persistent stream records.

Pinned `ws` 8.22.0 (already present transitively) as a direct runtime dependency and `@types/ws` 8.18.2 as development types after checking official npm metadata. npm reported 28 advisories (6 low, 18 moderate, 4 high), matching the prior recorded totals; this is not a fresh production security acceptance or an advisory fix.

## Verification results

- Final focused registry/peer/operator-context tests passed: 3 suites / 12 tests. Fake-time cases cover hash-only storage, endpoint scope, simultaneous redemption, per-device/account/process capacity, ticket expiration, sibling survival, final disconnect, absolute expiry, stalled checks/late completion, shutdown, outbound budget, transport-pong inactivity and reentrant-command rejection.
- Final full unit regression passed: 19 suites / 115 tests.
- HTTP E2E passed: 2 suites / 20 tests.
- Initial dedicated real-MongoDB/WebSocket integration passed: 26 tests. Final full regression passed: 10 suites / 163 tests, including all 27 native-connection cases and the additional real fixture-database disconnect/reopen case.
- Official Postman CLI regression passed: 83 requests / 322 assertions, zero failures, exit 0. The host closed and its exact disposable database was removed. No new live Postman requests or saved examples were added; feature-specific behavior is covered by the socket suite.
- Final non-writing TypeScript, clean lint, Nest build and task-source Prettier checks passed. Final schema generation passed and `contracts/schema.graphql` remained byte-unchanged. Markdown link/path and whitespace checks passed.

The real socket suite exercises both connection orders; duplicate authorization/subprotocol rejection; strict empty/native HTTP requests, browser/mixed transport rejection, no cookies/no-store; disabled service and missing required indexes; endpoint swap, bad token, query rejection, replay and concurrent redemption; account/device reservations and shared hashed budgets; malformed/unknown/binary/oversized input, invalid versions/fields and floods; refresh preserving established sockets and pending tickets; logout, reset, block/reactivation, role changes and owner/admin single/bulk revocation; original access expiry after refresh; a real thirty-second idle/ticket expiry; stalled/injected outage checks and late completion; actual fixture-database disconnection with identity-guarded reopening; content-log/persistence sentinels and application shutdown. Slow-consumer queue saturation and reentrant commands use controlled unit peers; this is not a network-throughput benchmark.

Each suite uses the existing dedicated test URI, exact generated `sbt_<32 hex>` database, initial emptiness verification and identity-guarded cleanup. No application database is a fixture. The new suite owns its externally supplied database connection separately from the Nest shutdown test and closes it after guarded deletion. Test listeners bind only random loopback ports. Feature enablement is a test-provider override; ignored `.env` and actual application settings remain untouched.

## Initial failures and corrections

The first registry TypeScript check exposed a UUID-default inference issue in a test helper; its parameter now explicitly accepts a string. Integration fixture enum literals and the Duplex shutdown helper were corrected before successful verification. A lint warning on WebSocket RawData stringification was fixed with explicit bounded byte conversion. These initial checks were not passes.

A new ticket-deadline regression failed before correction: second-endpoint validation crossing only its ticket deadline incorrectly closed the already-connected sibling. Endpoint expiry now detaches only that redemption, preserving the valid sibling. Absolute stream expiry and identity failures still invalidate access. The focused regression then passed.

The first complete integration run passed 161/162 tests. Its recovery CLI case exposed socket bootstrap assuming an HTTP adapter in a non-HTTP Nest application context; the child failed startup and reached its existing process timeout. Socket bootstrap now skips HTTP setup in operator contexts. A new unit regression passes, and the existing real private-pipe CLI case passed in isolation (one selected test, sixteen skipped in that focused command). This was a real compatibility defect, not a relaxed fixture assertion. Final full-suite results below supersede that failed run.

The first sandbox npm metadata request failed with DNS access restrictions; the permitted registry lookup/install succeeded. The first sandbox integration attempt failed before database connection; the permitted rerun passed all 26 tests. HTTP E2E initially failed with loopback EPERM; its permitted rerun passed all 20 tests. The first sandbox Postman attempt could not complete; the permitted rerun passed all assertions and confirmed cleanup. No assertion, identity requirement, rate budget or TLS/cookie policy was relaxed to obtain a pass.

## Limits and remaining work

Grants are process-local and replay-safe only within their lifetime; restart invalidates them. Native sockets require trusted WSS in deployment and custom native headers. Account/device revocation uses bounded polling, not instantaneous push. Refresh preserves a connection only until its original deadline. A reconnect requires new tickets. Readiness continues to certify core database/auth preparation only.

No private phone content was accessed, copied or erased. Static source review and sentinel rejection/persistence/log checks cover this increment's application behavior. They do not certify OS/proxy/swap/crash-dump/backup retention, packet capture, physical phone enrollment, mobile secure storage, production WSS, multiple instances or classroom vision. Binary samples are synthetic sentinel bytes, not real lecture images. The preserved unexpected empty application collection and recorded dependency findings remain unresolved. No administrator was bootstrapped in the application database, no actual account/content was mutated, no production deployment or push occurred.

## Changed paths

Production: `src/modules/analysis-access/` (configuration, access controller/service/module, identity validator, registry, socket service/peer and safe errors), `src/contracts/analysis-transport-v1.ts`, `src/app.module.ts`, `src/modules/auth/auth-session.service.ts`, `src/common/filters/http-error.filter.ts`, `.env.example`, `package.json`, `package-lock.json`.

Tests: the three focused registry/peer/operator-context `.spec.ts` files in that module and `test/analysis-transport.integration-spec.ts`.

Documentation: `contracts/analysis-transport.md`, `contracts/live-protocol.md`, `contracts/authentication.md`, `contracts/device-enrollment.md`, `contracts/errors.md`, `docs/Backend_plan.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md`, this verification record, `README.md`, `AGENTS.md`.

## Final completion evidence

Final full integration exited 0: 163/163 across ten suites (336 seconds), retaining all 136 existing cases and 27 foundation cases. Final unit regression exited 0: 115/115 across nineteen suites. Final HTTP regression exited 0: 20/20 across two suites. Final official Postman rerun exited 0: 83 requests / 322 assertions with zero failures, explicitly confirming host stop and exact disposable database removal. No failed or skipped check is included in these pass counts.

The actual outage case closes only the suite-owned disposable connection, observes 1011 socket closure and 503 grant rejection, then reopens the same exact fixture for guarded cleanup. The native suite separately owns that connection through application shutdown and final drop/close. All automated runs finished; their task-owned loopback services/connections closed and guarded disposable databases were deleted. Existing user hosts were neither stopped nor restarted. Application transport stays disabled by default and no ignored application setting was changed.

Final source/new-file review, explicit-path staged artifact/credential review and `git diff --check` precede the focused local feature commit. No build output, test databases, raw proofs/tokens, recordings or environment credentials belong to that commit.
