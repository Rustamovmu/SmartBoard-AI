# Backend development progress

## 2026-10-25 — B1 foundation

Scope: start the backend plan in the existing root-level NestJS project. This record supersedes historical MVP claims for the changed behavior only.

Implemented:

- V1 route/error/pagination/storage/analysis-limit contracts, with plan-agreement tests. Future routes and limits are explicitly specifications, not active services.
- Storage policy, forbidden endpoint/collection lists and candidate/local-save acknowledgment lifecycle. No private media persistence or lecture API.
- Validated environment configuration; port 3000 preserved and loopback binding by default. Existing `.env` is untouched and not automatically loaded.
- Separate health module: live 200; ready 503 because the database is not implemented.
- Safe HTTP errors; unexpected failures log a static status message only.
- E2E coverage of health, representative forbidden routes and error content redaction. Temporary test servers bind loopback and close after their suites.
- Product README and corrected stale companion links between the plans.

Reference inspection: `../trip-link/apps/trip-link/src/{main.ts,app.module.ts}` and `../nestar/apps/nestar-api/src/{main.ts,app.module.ts}`. Adapted feature/module separation; did not copy uploads, static media, content logging, business fields, ports or permissive CORS. These entry points provide no device-storage/transient-analysis equivalent.

Validation on 2026-10-25: `npm run lint` passed; `./node_modules/.bin/tsc --noEmit --incremental false` passed; `npm test -- --runInBand` passed (3 suites, 18 tests); `npm run test:e2e -- --runInBand` passed (2 suites, 17 tests); `npm run build` passed. The initial sandbox E2E run was blocked by loopback-listen EPERM; rerunning with the required permission passed. Both E2E apps closed their temporary loopback listeners. Local Markdown link/path checks and `git diff --check` passed. Prettier identified two formatting issues, corrected in the task files only.

Not implemented/verified: MongoDB, auth/session rotation, role/status checks, enrollment, GraphQL/schema generation, analysis/control WebSockets, Python/YOLO/OpenCV, frontend/native storage, phone recording, deployment/OS retention audit. No full V2 acceptance is claimed. The current `GET /` starter behavior remains available.

## Next — B2 platform identity

The user created the dedicated `SmartBoardAI` database and supplied its connection through the ignored `.env` (`MONGO_DEV`). Reuse that setting without exposing credentials; do not create a replacement Docker database or touch other databases. Confirm topology/transaction capability using a read-only connection before identity transactions. Keep disposable integration-test databases separate. Accounts/sessions, Argon2id, rotating refresh tokens, browser CSRF/cookies, native credential transport, current-account guards, enrollment, administrator bootstrap and last-admin protection need implementation and integration tests. Never commit credentials or ask users to paste them into chat.

B3 requires the actual separate frontend/native project location and physical phone testing. This backend alone cannot prove a local capture remains readable after app restart/backend shutdown.

## 2026-10-25 — B2 database foundation (identity not implemented)

Implemented a separate database module with pinned `@nestjs/mongoose` 12.0.0 and Mongoose 9.11.4, verified against official npm peer/engine metadata. Inspected the database modules in the two backend reference projects. Adapted standard connection-token injection without their environment conventions or raw connection logging. The custom factory prevents raw connection errors reaching startup/retry logs, disables automatic collections/indexes, buffering, debug and command monitoring, bounds timeouts/pools, and closes the app-owned connection on shutdown.

Start scripts now load `.env` if present; development supports the user's existing `MONGO_DEV`, with `MONGODB_URI` preferred and required in production. The dedicated database is `SmartBoardAI`; a mismatched URI is rejected. Test configuration never falls back to app credentials and requires a separate exact disposable name. No schemas or records are introduced yet.

Readiness now uses real bounded ping/topology probes: 200 for reachable/transaction-capable topology, 503 otherwise. HTTP suites inject explicit synthetic connection providers and verify ready/down/unsupported responses and connection cleanup. [API examples](Health_API.md) and [database setup](Database_setup.md) document identity requirements, prerequisites, expected outcomes and cleanup.

Live read-only evidence: `npm run db:check` reached `SmartBoardAI`, confirmed transaction-capable topology, counted 1 unexpected collection and 0 unexpected nonempty collections. It correctly exited 1 for this unresolved policy finding. No content was returned, no collection/record/index was changed or removed, and the connection was closed. The initial sandbox connection failed; the permitted network rerun reached the cluster. CRUD/transaction permissions remain untested. The empty pre-existing collection is preserved.

Validation: `npm run lint` passed (including `scripts/`); `./node_modules/.bin/tsc --noEmit --incremental false` passed; `npm test -- --runInBand` passed (7 suites, 43 tests, including rejection of application connections from Jest workers outside test mode); `npm run test:e2e -- --runInBand` passed (2 suites, 18 tests, synthetic database connections, temporary loopback listeners closed); `npm run build` passed. A Node.js import of the compiled `AppModule` also passed. Prettier, local Markdown link/path checks and `git diff --check` passed. Live `db:check` remains a correctly reported policy failure as described above, not a passing retention/CRUD test.

Dependency audit: `npm audit` reported 9 existing findings (2 low, 1 moderate, 6 high). Every reported package/version was already in the prior committed lockfile and unchanged by the Mongoose install; no Mongoose/driver advisory was reported. Findings involve existing Nest Express/multer and Mau tooling chains. No forced downgrade or unrelated dependency rewrite was performed. Resolve these before production acceptance; this increment is development infrastructure only.

B2 account/session/authentication/enrollment/admin acceptance remains open. No write-based integration suite, schema generation or actual account transaction has been executed. Physical phone/vision and deployment-wide retention checks remain outside this increment.

## Exact changed-file inventory

### B1 (`6c0ca38`)

```text
.env.example
AGENTS.md
README.md
contracts/errors.md
contracts/live-protocol.md
contracts/storage-policy.md
docs/Backend_plan.md
docs/Development_progress.md
docs/Frontend_plan.md
src/app.module.ts
src/common/filters/http-error.filter.ts
src/config/app-config.service.ts
src/config/config.module.ts
src/config/environment.spec.ts
src/config/environment.ts
src/contracts/platform-v1.spec.ts
src/contracts/platform-v1.ts
src/main.ts
src/modules/health/health.controller.ts
src/modules/health/health.module.ts
src/modules/health/health.service.ts
test/app.e2e-spec.ts
test/http-error.e2e-spec.ts
```

### B2 database foundation

```text
.env.example
AGENTS.md
README.md
contracts/errors.md
docs/Database_setup.md
docs/Development_progress.md
docs/Health_API.md
package-lock.json
package.json
scripts/check-database.ts
src/app.module.ts
src/config/app-config.service.ts
src/config/database-environment.spec.ts
src/config/database-environment.ts
src/database/database-health.spec.ts
src/database/database-health.ts
src/database/database.module.ts
src/database/database.service.spec.ts
src/database/database.service.ts
src/database/platform-connection.spec.ts
src/database/platform-connection.ts
src/modules/health/health.controller.ts
src/modules/health/health.module.ts
src/modules/health/health.service.ts
test/app.e2e-spec.ts
test/helpers/connection-stub.ts
test/http-error.e2e-spec.ts
```

## 2026-10-25 — B2 account authentication increment

Implemented separate members/auth/audit modules with strict Mongoose schemas (`users`, `authSessions`, `authAttempts`, `auditEvents`), explicit non-destructive schema preparation and atomic administrator bootstrap/audit. Public signup creates USER only. Added HTTP signup/login/refresh/logout/me/CSRF, bounded strict JSON/DTO validation, Argon2id passwords, hashed random opaque credentials, 15-minute access, fixed 30-day session maximum, atomic rotation/replay revocation, current-account role/status/version checks, isolated logout, MongoDB rate limits, Secure/HttpOnly/Strict host cookies and origin/CSRF protection. No phone-file access or lecture persistence was added.

Reference inspection: TripLink auth controller, cookie/session/rate-limit services, current-account guard and account policy; Nestar auth module. Adapted module/service/schema/guard boundaries and inspected rotation races, without importing legacy roles, media, DTOs, ports, credentials or reference-specific approval gates. Used official Nest validation, OWASP password/CSRF and Postman documentation for the implementation/test workflow.

The user supplied dedicated `MONGODB_TEST_URI` and explicitly authorized removing its database path. Only that ignored setting was changed; application `MONGO_DEV` and other settings were preserved. Disposable names now use `sbt_<32 hex digits>` because the provided cluster rejected the previous 46-byte design with a 38-byte name limit. Every cleanup checks the exact configured/connected generated name and refuses production mode/nonempty initial databases. No application records were used as fixtures, no real administrator created, and no test container was created.

Real integration coverage includes actual Argon2id and MongoDB indexes/transactions; signup/session atomic rollback; concurrent unique-email signup; sequential and concurrent refresh replay; forged family proof; expiry without relying on TTL; lifetime clamping; current role/status and revocation; isolated logout; login rate limits; unknown/private/operator inputs; body size/type/parse errors; cookie/CSRF checks; explicit admin CLI/audit; forbidden endpoints/collections. Initial setup failures exposed an inaccessible test guard dependency and the name limit before fixture writes; later checks exposed and fixed parser 413 mapping and an Argon2 parameter-order test assumption. Code review added a non-ASCII CSRF rejection check to prevent byte-length comparison errors.

Postman evidence: official CLI 1.76.0 ran 25 ordered saved requests with 86 assertions, zero failures, exit 0, against a dedicated loopback host/real disposable database, with cloud reporting disabled and no Postman account/API key. The repeatable `npm run postman:test` passed and verified automatic listener/database cleanup. An earlier manual npm/PTY interruption missed its cleanup completion; the exact known database was subsequently removed with guarded cleanup, then an awaited wrapper and idempotent signal handling were added. Desktop import was attempted, but macOS ScreenCaptureKit failures prevented verifying import/run. No desktop/cloud success is claimed. The saved collection uses runtime variables for synthetic credentials; committed examples/evidence contain no real credential or connection string.

Operational note: while the user initially selected local Docker tests, attempting to open stopped Docker Desktop likely resumed existing TripLink containers via their existing restart policies. Read-only inspection found `triplink-next` restarting with exit 1 and policy `always`; API/batch had also resumed. No sibling repository files, container definitions, images, start/stop/rebuild/delete commands were changed/run. The user then chose supplied MongoDB; no Docker test infrastructure was created and unrelated containers were left alone.

Validation on 2026-10-25: lint, non-writing TypeScript inspection, Nest build and compiled-module import passed; unit tests passed (12 suites, 70 tests); root E2E passed (2 suites, 18 tests); real MongoDB integration passed (1 suite, 17 tests); final official Postman CLI run passed (25 requests, 86 assertions, exit 0) and confirmed automatic cleanup. Prettier, local Markdown links/Postman JSON and whitespace checks passed. Detailed HTTP transport, secure bootstrap input, rates, errors and disposable prerequisites/cleanup are in [authentication contract](../contracts/authentication.md); real Postman scope and limitations are in [Postman verification](Postman_Auth_Verification.md).

Remaining B2: enrollment; administrator account/role/status mutation policies and last-active-admin protection; full recovery flow; coordinated revocation of future connected streams. Refresh currently has strict single-use semantics, requiring client serialization and fresh login after a lost response; no idempotent retry grace is claimed. Trusted browser HTTPS, native Keychain/Keystore adapters, phone persistence, GraphQL, WebSockets, vision and deployment retention remain unimplemented/unverified. The nine prior dependency advisories remain outside production acceptance; installs still report the same totals. The application's pre-existing empty unexpected collection remains untouched.

Application setup: `npm run db:prepare` successfully created/prepared only the four allowed platform collections and declared indexes in `SmartBoardAI`; no account/record was inserted and nothing was dropped. The subsequent read-only `db:check` reported reachable/transaction-capable database, 5 collections, 1 unexpected collection and 0 unexpected nonempty collections. It correctly exited 1 for the preserved empty policy finding. That pre-existing collection remains unresolved, rather than being silently deleted or calling the policy check passed. Temporary SmartBord listeners were closed, including the final Postman port checked with no listener remaining. Unrelated processes were left alone.

### Exact changed files — B2 authentication increment

```text
.env.example
AGENTS.md
README.md
contracts/authentication.md
contracts/errors.md
docs/Database_setup.md
docs/Development_progress.md
docs/Health_API.md
docs/Postman_Auth_Verification.md
package-lock.json
package.json
postman/SmartBoardAI.postman_collection.json
postman/verification-2026-10-25.json
scripts/create-admin.ts
scripts/lib/disposable-database.spec.ts
scripts/lib/disposable-database.ts
scripts/lib/postman-host.ts
scripts/postman-server.ts
scripts/prepare-database.ts
scripts/run-postman.ts
src/app.module.ts
src/app.setup.ts
src/common/filters/http-error.filter.ts
src/config/auth-environment.spec.ts
src/config/auth-environment.ts
src/config/database-environment.spec.ts
src/config/database-environment.ts
src/contracts/auth-v1.ts
src/contracts/platform-v1.ts
src/main.ts
src/modules/audit/audit.module.ts
src/modules/audit/audit.service.ts
src/modules/audit/schemas/audit-event.schema.ts
src/modules/auth/auth-rate-limit.service.ts
src/modules/auth/auth-schema.service.ts
src/modules/auth/auth-session.service.ts
src/modules/auth/auth-transport.service.spec.ts
src/modules/auth/auth-transport.service.ts
src/modules/auth/auth.config.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.module.ts
src/modules/auth/auth.service.ts
src/modules/auth/dto/auth.dto.ts
src/modules/auth/guards/admin.guard.ts
src/modules/auth/guards/auth-entry.guard.ts
src/modules/auth/guards/current-account.guard.ts
src/modules/auth/password.service.spec.ts
src/modules/auth/password.service.ts
src/modules/auth/schemas/auth-attempt.schema.ts
src/modules/auth/schemas/auth-session.schema.ts
src/modules/auth/token.service.spec.ts
src/modules/auth/token.service.ts
src/modules/health/health.module.ts
src/modules/health/health.service.ts
src/modules/members/members.module.ts
src/modules/members/members.service.ts
src/modules/members/schemas/member.schema.ts
test/app.e2e-spec.ts
test/auth.integration-spec.ts
test/helpers/connection-stub.ts
test/http-error.e2e-spec.ts
test/jest-integration.json
```

## 2026-11-02 — GraphQL account administration increment

Added the planned Nest Apollo GraphQL boundary at `POST /graphql`, with current-account query, bounded/filterable admin account pagination and audited role/status mutation. Public authentication stays HTTP. Current-account/transport/origin/CSRF/rate/index checks precede GraphQL work; DTOs reject unknown/null/operator inputs. Introspection, IDEs, batching, persisted queries and document caching are disabled. Requests retain the 8 KiB JSON limit, one operation, five root fields, 80 AST fields, six selection levels/definitions and safe errors without input/suggestion/stack serialization. The generated `contracts/schema.graphql` is checked against the running schema; generation opens no DB or listener.

Account access changes run in a transaction: reauthenticate the actor, change only role/status, increment target auth version, revoke all target sessions and record bounded before/after audit fields. Audit failure rolls everything back. Reactivation does not restore old credentials; role changes require fresh login. DELETED is reversible soft status, not data erasure. The last active admin cannot be demoted, blocked or soft deleted. A shared `platformSettings` policy write serializes all administrator mutations and CLI bootstrap before permission/count checks, preventing snapshot write skew and stale-actor cross-block races. Explicit preparation seeds the policy once, preserves revisions and fails closed when absent. No private phone-file action or lecture persistence was added.

Reference inspection: read-only TripLink member resolver, update service and GraphQL auth/roles guards. Adapted resolver/service/input/guard boundaries and request context; did not copy its roles, upload scalars, business/profile fields, pagination or self-change policy. This project's transactional last-admin invariant is implemented and tested separately. Used official Nest GraphQL/Apollo documentation linked in the [account contract](../contracts/platform-accounts.md). No Docker action or sibling repository change occurred in this increment.

Pinned compatible dependencies from official npm peer/engine metadata: `@nestjs/graphql` 14.1.0, `@nestjs/apollo` 14.1.1, `@apollo/server` 5.5.1, `@as-integrations/express5` 1.1.2 and GraphQL 16.14.2. The Apollo peer range requires GraphQL 16, so the current GraphQL 17 release was not selected. Node 24, npm, CommonJS/nodenext and existing Jest configuration remain unchanged. The current audit reports 28 findings (6 low, 18 moderate, 4 high). Comparing every flagged installed package path/version with the pre-change lockfile found no changed/new flagged versions and no finding attributed to a new GraphQL package. This updates advisory evidence, not production approval; existing findings remain unresolved. No force fix, downgrade or unrelated dependency rewrite was performed.

Validation on 2026-11-02: lint and non-writing TypeScript inspection passed; unit tests passed (14 suites, 77 tests); root HTTP E2E passed (2 suites, 18 tests); real disposable MongoDB integration passed (2 suites, 31 tests), including a second full run after document-limit tightening. The new integration cases prove schema equality, USER/IDOR rejection, bounds/null/operator validation, last-admin demotion/block/deletion rejection, all-session revocation/reactivation, role changes, simultaneous self-demotions/cross-blocks, missing-policy failure, idempotent preparation, audit rollback, CSRF/origin, disabled GET/batching/introspection, safe errors and rate limiting. Nest build passed. An initial compiled-module smoke command pointed at a nonexistent `dist/src/` path; correcting it to the actual `dist/app.module.js` passed without changing build layout.

The expanded official Postman CLI collection passed 41 requests and 150 assertions, zero failures, exit 0. Its host creates one synthetic audited administrator only after verifying its generated database starts empty. No real administrator/account is created by tests. The wrapper closed its listener and removed the exact guarded test database; the final loopback port had no listener. Cloud reporting was disabled, no account/API key used, and no raw credential reports were saved. Desktop import/run remains unverified due to the earlier capture failure. See [Postman evidence](Postman_Auth_Verification.md).

Application setup: explicit `db:prepare` succeeded for the five allowed platform collections/indexes and singleton administrator policy. It inserted no account, overwrote no existing policy and dropped nothing. The read-only `db:check` returned database up, transactions supported, 6 total collections, 1 unexpected collection and 0 unexpected nonempty collections. It correctly exited 1 for the pre-existing empty policy finding; that collection remains untouched. Temporary test hosts/connections were closed; unrelated processes were left alone. No application credentials or ignored environment files were changed.

Final review: Prettier, changed Markdown link/JSON checks, manifest/lockfile agreement, preservation of the original 25 Postman request definitions, task secret/artifact scan and `git diff --check` passed. No private environment values were printed.

Remaining B2: enrollment/device access, recovery flow and coordinated revocation of future connected streams. No actual administrator was bootstrapped in SmartBoardAI. Published-content operations, WebSockets, vision, native secure storage, trusted-browser HTTPS, phone persistence and deployment retention remain unimplemented/unverified. This completes the GraphQL account administration increment, not all B2 or V2 acceptance.

### Exact changed files — GraphQL account administration

```text
AGENTS.md
README.md
contracts/authentication.md
contracts/errors.md
contracts/platform-accounts.md
contracts/schema.graphql
docs/Database_setup.md
docs/Development_progress.md
docs/Postman_Auth_Verification.md
package-lock.json
package.json
postman/SmartBoardAI.postman_collection.json
postman/verification-2026-11-02.json
scripts/create-admin.ts
scripts/generate-schema.ts
scripts/lib/postman-host.ts
scripts/prepare-database.ts
src/app.module.ts
src/app.setup.ts
src/common/filters/http-error.filter.ts
src/graphql/document-limits.spec.ts
src/graphql/document-limits.ts
src/graphql/graphql-admin.guard.ts
src/graphql/graphql-context.ts
src/graphql/graphql-errors.spec.ts
src/graphql/graphql-errors.ts
src/graphql/platform-graphql.module.ts
src/modules/admin/admin-policy.module.ts
src/modules/admin/admin-policy.service.ts
src/modules/admin/admin.module.ts
src/modules/admin/admin.resolver.ts
src/modules/admin/admin.service.ts
src/modules/admin/dto/account.dto.ts
src/modules/admin/schemas/admin-policy.schema.ts
src/modules/audit/audit.service.ts
src/modules/audit/schemas/audit-event.schema.ts
src/modules/auth/auth-session.service.ts
src/modules/auth/auth.module.ts
test/admin.integration-spec.ts
test/auth.integration-spec.ts
```

## 2026-11-02 — Device enrollment and revocation increment

Implemented a separate `device-enrollment` module with strict `devices`/`pairingRequests` schemas and explicit non-destructive setup. GraphQL adds `createDevicePairing`, `confirmDevicePairing`, `currentDevice`, `myDevices`, `adminDevices`, `revokeDevice` and `adminRevokeDevice`. The [enrollment contract](../contracts/device-enrollment.md) specifies exact queries, Variables, roles, bounds, errors, prerequisites and cleanup. Schema generation includes the resolver without an application connection/listener.

A native account session creates a five-minute random 256-bit code; only its SHA-256 hash is retained. A different session of the same owner approves it; even an admin cannot approve another owner's code. Approval atomically creates the device, binds the target session, consumes the request and audits IDs/action/time only. Replacing a pending request invalidates its old code. Expiry/single-use checks do not depend on TTL cleanup. Account-scoped limits cover failed attempts, and a serialized 20-active-device cap prevents concurrent overflow.

Owners/admins can list and revoke permitted devices. Revocation atomically marks the device, revokes all bound sessions and audits the action; repeating it is a no-op. Access authentication and refresh independently verify current bound-device owner/status/existence. Refresh preserves binding and session lifetime. Enrollment/revocation share the existing administrator policy write with account access changes, ensuring retries recheck current actor/account state. Account blocking invalidates every session; reactivation restores none. Fresh login remains unbound and requires explicit new enrollment. This binds an auth-session family, not attested permanent hardware identity or a reusable device credential. No lecture/media, phone-file access, remote wipe, new dependency or frontend/Python target was introduced.

Reference inspection: read-only TripLink auth-session/auth-records services and Nestar auth guard. These supply current-session patterns but no equivalent single-use device pairing/local-storage implementation; the new contract follows this project's plans. Used official Mongoose transaction/retry and Node cryptographic-randomness documentation linked in the contract. Sibling projects were unchanged.

Validation on 2026-11-02: non-fixing lint passed with no warnings; non-writing TypeScript inspection passed; unit tests passed (14 suites, 77 tests); HTTP E2E passed (2 suites, 18 tests); real disposable MongoDB integration passed (3 suites, 46 tests). Fifteen new integration cases cover hashed codes, session binding/refresh, supersession, expiry independent of TTL, self/foreign/replay rejection, ownership/admin access, revocation/no-op/self-revocation, current device state, audit rollback, concurrent approval/device cap, account-block/reactivation and refresh/revocation races, validation, rate limits, missing indexes/idempotent setup and browser-wire CSRF/origin. Nest build and versioned schema generation passed; the existing integration schema-equality check passed. Initial sandbox MongoDB/loopback runs were blocked; approved reruns passed. Their failures are not counted as passing checks.

Official Postman CLI 1.76.0 passed 57 requests/215 assertions with zero failures and exit 0. Sixteen new enrollment requests use a separate synthetic owner. One prior assertion was updated for the deliberately generalized fixed GraphQL conflict message; stable codes/statuses are unchanged. Earlier expanded runs failed on that stale assertion and cleaned up; the runner now reports only a known static request name on failure, preserving credential redaction. See [Postman evidence](Postman_Auth_Verification.md) and the [sanitized result](../postman/verification-2026-11-02-enrollment.json). No cloud reporting, saved live responses or raw credential reports were added.

All integration/Postman fixtures used exact generated `sbt_<32 hex digits>` databases through the dedicated test URI, checked empty before setup and identity-guarded before cleanup. Own temporary loopback hosts/connections were closed and owned databases removed. No application setup, application-record mutation, administrator bootstrap or environment change was performed. Before using enrollment on the application DB, an operator must run explicit `db:prepare`; application readiness still checks topology/auth indexes only. Prior empty unexpected-collection and dependency-advisory findings remain unresolved; no new audit/deployment acceptance is claimed.

Final review: compiled `dist/app.module.js` imports without starting an app; task TypeScript/JSON and the new contract pass Prettier; all 64 local Markdown links in changed documents resolve; JSON, secret/artifact scan and `git diff --check` pass. The final Postman port has no remaining listener. The reviewed inventory includes every untracked task file.

Remaining B2: admin-assisted recovery and coordinated revocation of future connected streams. WebSockets/analysis grants, permanent device reattachment credentials, native Keychain/Keystore adapters, trusted-browser HTTPS, physical phone UI/storage, vision and deployment-wide retention remain unimplemented/unverified. Device revocation affects platform access only; private local files remain outside backend authority.

### Exact changed files — device enrollment

```text
AGENTS.md
README.md
contracts/authentication.md
contracts/device-enrollment.md
contracts/errors.md
contracts/platform-accounts.md
contracts/schema.graphql
docs/Database_setup.md
docs/Development_progress.md
docs/Postman_Auth_Verification.md
postman/SmartBoardAI.postman_collection.json
postman/verification-2026-11-02-enrollment.json
scripts/generate-schema.ts
scripts/lib/postman-host.ts
scripts/prepare-database.ts
scripts/run-postman.ts
src/app.module.ts
src/graphql/graphql-errors.ts
src/modules/audit/audit.service.ts
src/modules/audit/schemas/audit-event.schema.ts
src/modules/auth/auth-session.service.ts
src/modules/auth/auth.module.ts
src/modules/auth/guards/current-account.guard.ts
src/modules/auth/schemas/auth-session.schema.ts
src/modules/device-enrollment/device-enrollment.module.ts
src/modules/device-enrollment/device-enrollment.resolver.ts
src/modules/device-enrollment/device-enrollment.service.ts
src/modules/device-enrollment/device-records.module.ts
src/modules/device-enrollment/device-schema.service.ts
src/modules/device-enrollment/dto/device.dto.ts
src/modules/device-enrollment/schemas/device.schema.ts
src/modules/device-enrollment/schemas/pairing-request.schema.ts
test/device-enrollment.integration-spec.ts
```

## 2026-11-02 — Atomic selected-device batch API

Added `revokeDevices` and `adminRevokeDevices` at `POST /graphql` with a validated `RevokeDevicesInput`: 1–20 distinct opaque device UUIDs. Owner selections require every device to belong to the caller; current ADMIN selections can span accounts. Both return one complete `DevicePage` in submitted order (`page: 1`, `pageSize`/`total` equal selection size). See [exact operations/Variables and limits](../contracts/device-batches.md). Generic GraphQL HTTP batching remains disabled. No batch account mutation, frame upload/analysis or background job was introduced.

One transaction acquires the existing administrator policy write, reauthenticates the actor, validates the complete permitted selection, updates newly revoked devices and their bound sessions, and appends one audit per changed device. Missing/foreign IDs cause the same generic whole-batch rejection. Later audit failure rolls back all prior device/session/audit writes. Already-revoked devices retain their original timestamp without another event. Single-device endpoints share this implementation and preserve their response shape. Overlapping batches and account role/status changes use the same policy ordering; self-revocation invalidates the caller only after the successful action. Phone files remain outside backend authority.

Extended the existing MongoDB limiter with an atomic positive-integer cost, defaulting to 1 for existing callers. All single/bulk owner/admin revocations share 20 submitted IDs per actor account per epoch minute, including no-op/failed business attempts. A selection that cannot fit is rejected without reserving additional cost or performing revocation. This prevents a 20-device request from bypassing the prior per-device work budget. Other authentication and GraphQL limits remain unchanged. No dependency, collection, index or application setup change is required beyond the existing enrollment prerequisites.

Read-only reference inspection: TripLink auth-session `revokeAll`/auth-records transaction serialization and Nestar auth boundaries. They provide no atomic batch of selected enrolled devices, so the implementation uses this project's ownership, transaction and audit policies rather than copying reference wire shapes or business fields. Sibling repositories and environment files were unchanged.

Validation: non-fixing lint, non-writing TypeScript inspection, schema generation, Nest build and compiled `AppModule` import passed. Unit tests passed (14 suites, 77 tests); HTTP E2E passed (2 suites, 18 tests). The initial real integration run passed 55/56 tests, including all ten new batch cases, but an older rate-limit test crossed its minute window and failed a timing-dependent expectation. That fixture now verifies a failed attempt increments persistent budget and seeds bounded adjacent-bucket counters in its guarded disposable database; production minute windows/limits are unchanged. The corrected full integration rerun passed (3 suites, 56 tests). Ten new cases prove owner/admin selection scope, whole-batch missing/foreign rejection, validation, the 20-device boundary, weighted shared quotas, second-audit rollback, overlap timestamp/audit preservation, concurrent admin demotion and self-revocation; the existing browser case now also proves batch CSRF/origin enforcement.

Official Postman CLI passed 70 requests/269 assertions, zero failures and exit 0, preserving all prior 57 request definitions and adding 13 batch scenarios. Its exact disposable database was removed and loopback host closed. No application records, real accounts/devices or private lecture content were used as fixtures. Temporary integration apps own and close their connections/listeners and identity-guard their generated database cleanup. Application `db:prepare`/`db:check`, administrator bootstrap and deployment were not run. Existing recovery/native/vision/WebSocket and production-retention/dependency limitations remain outside this increment.

Final review: all 14 task files were reviewed, including untracked contract/evidence files; all 54 local Markdown links resolve; task TypeScript/JSON and enrollment/batch contracts pass Prettier; JSON, secret/artifact scan and `git diff --check` pass. The prior 57 Postman definitions are unchanged. No new dependency/lockfile, generated build artifact, credential or private lecture file is included.

### Exact changed files — selected-device batches

```text
AGENTS.md
README.md
contracts/device-batches.md
contracts/device-enrollment.md
contracts/schema.graphql
docs/Development_progress.md
docs/Postman_Auth_Verification.md
postman/SmartBoardAI.postman_collection.json
postman/verification-2026-11-02-device-batches.json
src/modules/auth/auth-rate-limit.service.ts
src/modules/device-enrollment/device-enrollment.resolver.ts
src/modules/device-enrollment/device-enrollment.service.ts
src/modules/device-enrollment/dto/device.dto.ts
test/device-enrollment.integration-spec.ts
```

## 2026-11-02 — Operator-assisted password recovery

Implemented explicit local `recovery:issue` and `POST /auth/password/reset` as the next B2 identity increment. The [recovery contract](../contracts/password-recovery.md) documents the exact CLI invocation, payload, identity boundary, success/rejections, limits, setup and cleanup. Both V2 plans and the framework-independent shared routes now include the reset endpoint. There is no production HTTP/GraphQL issuer, email/notification integration or reset UI. Operators must independently verify ownership and privately deliver the proof.

Issuance generates a 256-bit random, 15-minute proof and transactionally replaces one hidden hash/expiry/auth-version tuple on the ACTIVE account with a local-command audit event. It does not change role/status/password/sessions. The unique sparse recovery-hash index is explicit setup; no collection or dependency was added and users have no TTL index. Expiry is enforced directly. Unused expired metadata stays bounded to one tuple per account; successful reset unsets it. Core readiness/authentication still checks its existing indexes; recovery separately fails closed before its index is prepared.

Reset validates current proof/status/version before Argon2 work and inside the shared administrator-policy transaction after hashing/retries. It atomically changes the password, advances auth version, consumes the proof, revokes every account session and records a bounded `RECOVERY_CREDENTIAL` audit event. Concurrent consumption cannot both succeed; supersession, expiry, role/status changes and later reactivation cannot revive an old proof. Audit failure rolls everything back. Browser origin/CSRF checks apply and successful browser reset clears cookies. No automatic login occurs. The last ACTIVE ADMIN can recover without changing its role; BLOCKED/DELETED/missing accounts are refused. Device inventory and phone files remain intact.

The npm CLI requires explicit `--private-output`, a private pipe/socket output and separate diagnostics; ordinary invocation, terminal/file output and merged stderr are refused before issuance. Its normal diagnostic messages never include the proof. The private JSON channel carries only proof/expiry to the operator's approved recipient, with no proof in argv or a saved file. Issuance precedes delivery, so failed/lost delivery requires explicit reissue. Real npm delivery was tested with an in-memory recipient; macOS clipboard/human delivery was not exercised.

Reset limits are 10/IP/minute and 5/hashed proof/minute, plus the shared two-operation Argon2 bound. Failed service attempts consume their independent budget; unusable proofs skip expensive password work. Unknown/private/operator fields and invalid passwords do not consume the proof. Secrets remain absent from public DTOs/schema, audit payloads and normal logs. No lecture/media storage or new frontend/Python target was introduced.

Read-only reference inspection: TripLink account-security reset controller/service and auth-record transaction serialization; adapted separation of validated HTTP inputs, services, version checks and revocation without copying its email/provider flow, usernames, recovery-code schema, credentials or data. Used [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) for random expiring single-use proofs and normal login/session invalidation, retaining this project's no-token-in-URL rule. Sibling repositories were unchanged.

Validation on 2026-11-02: lint (no warnings), non-writing TypeScript inspection, unit tests (14 suites/77 tests), HTTP E2E (2 suites/18 tests), real disposable MongoDB integration (4 suites/73 tests), Nest build and compiled `AppModule` import passed. Seventeen new integration cases cover real Argon2, hidden metadata, all-session/device-bound revocation, proof supersession/replay/expiry, concurrent consumers, issuance/reset audit rollback, blocked/deleted/reactivated accounts, roles/last admin, blocking during hashing, issuance/reset races, invalid/private/operator inputs, budgets, missing-index/idempotent setup, actual npm private-pipe CLI delivery and browser CSRF/cookie clearing. Schema generation passed and the GraphQL artifact remained unchanged; the real schema-equality regression also passed. A focused follow-up passed the production-boundary case with an added assertion that the test-only proof fixture is absent from AppModule (1 selected test passed; 16 other recovery tests were not selected in that focused run).

Official Postman CLI 1.76.0 passed 83 requests/322 assertions, zero failures and exit 0. All prior 70 request definitions are unchanged. The disposable host adds a one-shot marked fixture channel for a fixed synthetic account at the later collection step, not an arbitrary-account issuer or production route. The random proof exists only in runtime variables and is not in CLI arguments, saved responses/examples, raw reports or evidence. See [Postman verification](Postman_Auth_Verification.md) and the [sanitized result](../postman/verification-2026-11-02-password-recovery.json).

Tests used only initially empty, exact generated `sbt_<32 hex digits>` databases through the dedicated test URI. Their cleanup verified exact configured/connected identity, removed only owned test databases and closed their own loopback apps/connections. CLI negative-output testing used an owned empty temporary file which was removed; no proof bytes were written to it. The final Postman port has no listener. Application setup/inspection, real-account issuance/reset, administrator bootstrap, environment changes and deployment were not performed. Explicit `db:prepare` is required before using recovery on the application database.

Remaining acceptance: actual separate frontend/native project and physical phone save/reopen proof, native secure storage and recovery UI, trusted browser HTTPS, independent operator identity-verification/delivery procedures, email notifications, connected-stream shutdown, vision and deployment-wide retention. Existing dependency-advisory/empty unexpected application-collection findings remain unresolved. This completes the recovery backend increment, not all B2/V2 or production acceptance.

Final review: all 26 task files, including untracked source/tests/contract/evidence, were reviewed. All 74 local Markdown links resolve; task TypeScript/JSON and the recovery contract pass Prettier; JSON, manifest/lockfile agreement, credential/artifact scan and `git diff --check` pass. The prior 70 Postman request definitions and generated GraphQL schema are unchanged. No credential, environment file, build output, dependency or private lecture artifact is included.

### Exact changed files — password recovery

```text
AGENTS.md
README.md
contracts/authentication.md
contracts/password-recovery.md
docs/Backend_plan.md
docs/Database_setup.md
docs/Development_progress.md
docs/Frontend_plan.md
docs/Health_API.md
docs/Postman_Auth_Verification.md
package.json
postman/SmartBoardAI.postman_collection.json
postman/verification-2026-11-02-password-recovery.json
scripts/issue-password-recovery.ts
scripts/lib/postman-host.ts
src/contracts/platform-v1.ts
src/modules/audit/audit.service.ts
src/modules/audit/schemas/audit-event.schema.ts
src/modules/auth/auth-schema.service.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.module.ts
src/modules/auth/dto/auth.dto.ts
src/modules/auth/guards/auth-entry.guard.ts
src/modules/auth/password-recovery.service.ts
src/modules/members/schemas/member.schema.ts
test/password-recovery.integration-spec.ts
```

## 2026-11-02 — Application setup and frontend handoff

The user authorized proceeding with application schema preparation, metadata verification and the subsequent mobile storage foundation. `npm run db:check` before setup reached `SmartBoardAI`: database up, transactions supported, 6 collections, 1 unexpected and 0 unexpected nonempty. It exited 1 for the preserved empty policy finding. `npm run db:prepare` completed with exit 0, preparing all seven declared platform collections/indexes and passing its auth/recovery/device index assertions. The administrator policy setup does not overwrite an existing revision. No account, recovery proof or password was created/changed; no record/index or unexpected collection was removed.

The final `db:check` reached the same application DB and reported up/supported, 8 collections, 1 unexpected and 0 unexpected nonempty, again correctly exiting 1 for the same empty collection. It was preserved. Connections were closed; no HTTP host, CRUD fixture, administrator bootstrap or recovery action was run against application records. No credentials or record contents were printed and ignored `.env` was unchanged. The commands used approved network access. This is application setup evidence, separate from earlier disposable CRUD tests and physical-device/retention acceptance.

The user selected `/Users/a1234/Developer/SmartBord-AI-frontend` for a new separate repository and requested both Android and iPhone verification. The destination did not yet exist during this setup increment. Local inventory found only the legacy `whiteboard detection/frontend` React/Vite project, which was left unchanged. The authorized new location is now recorded in AGENTS.md and the frontend plan. F1 implementation and actual phone results remain to be recorded in the separate repository; no mobile acceptance is claimed here.

Environment inspection found an Android SDK with API 36/platform-tools/build-tools and Java 24. Full Xcode and Android Studio apps are absent; the selected Apple developer directory is Command Line Tools. iPhone native build/signing requires full Xcode before it can be verified. No SDK/IDE installation or device change was performed in this setup increment.

Validation: actual setup and before/after metadata commands as above; local Markdown links, scoped diff and whitespace checks. Application tests/build were not rerun because no application source changed. Changed files: `AGENTS.md`, `docs/Database_setup.md`, `docs/Development_progress.md`, `docs/Frontend_plan.md`.

## 2026-11-02 — Separate mobile photo-storage foundation

Created the authorized separate `/Users/a1234/Developer/SmartBord-AI-frontend` repository on branch `develop`, local commit `ab18075` (`feat: add native phone-local photo storage foundation`). Its [README](../../SmartBord-AI-frontend/README.md) and [verification record](../../SmartBord-AI-frontend/docs/Verification.md) contain setup, exact checks, artifact checksum and the Android/iPhone test protocol. No frontend tree was added to this backend, and legacy/reference repositories were left unchanged.

The mobile project includes React/Vite/Capacitor Android/iOS wrappers, an initial SQLite catalog and durable original-photo adapter. It creates local lectures, captures camera-returned JPEGs, checks stage/final bytes and SHA-256, commits capture/pending changes atomically and verifies originals on reopen. Idempotent requests, one in-flight save, bounded 20 MB reads and interrupted-save recovery preserve incomplete files rather than silently replacing/deleting them. The browser fallback disables persistence and displays no fabricated samples/success. Private lecture metadata/files never enter a backend API in this build: there is no API client, upload or telemetry. Production CSP blocks connections, bridge logging is disabled, Android backup/transfer exclusions are configured and iPhone startup checks vault backup exclusion before constructing the bridge. Actual OS backup and deployment/packet retention auditing are not established by source configuration.

Frontend validation passed: TypeScript inspection, lint without warnings, 3 suites/15 tests (synthetic ports/mocked SDK plus real in-memory Node SQLite constraints/rollback), Vite build, native project synchronization and Chromium fallback checks at mobile/desktop sizes. Screenshots were visually inspected. Android `assembleDebug` passed with the installed API 36 SDK, Gradle 8.14.3 and a checksum-verified temporary Temurin Java 21 toolchain; system Java selection was unchanged. The Java 24-only attempt and initially missing Chromium executable failed before the verified fixes/retries. iPhone project/plist/privacy files pass syntax checks, but full Xcode is absent and no iOS compilation/signing/runtime is claimed. Runtime npm audit reports zero advisories; four moderate development-tool findings remain in the Capacitor CLI glob/minimatch chain, documented without a forced incompatible downgrade.

No Android phone was connected; no emulator or phone app ran. The user explicitly deferred device setup. Physical Android/iPhone capture, kill/reopen with backend unavailable, permissions/storage failures, interruptions and OS backup audits remain pending; F1/B3 is not accepted. Next.js, native authentication/logout, video/audio, AI, gallery/Photos/bundle/PDF export and the connected analysis/ack protocol are not implemented by this increment. Logout/block file-preservation tests await native auth integration. No phone photo/catalog was copied to the Mac and no private lecture content was given to MongoDB or the backend. Temporary browser listeners and the task-started ADB server were closed; single-use Gradle daemons exit after builds. Backend hosts remained stopped.

The separate frontend commit contains 99 reviewed source/config/template/test/documentation files and the npm lockfile; generated web assets, native build outputs, local SDK/signing files, databases, credentials and private media are excluded. Backend handoff changes are documentation only: `AGENTS.md`, `README.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md`. Validation here is link/path, accuracy, scoped diff and whitespace review; backend application suites were not rerun for this handoff.

## 2026-11-02 — Separate Pages Router website authentication

The user selected the existing `/Users/a1234/Developer/smartbord-ai-frontend-web` starter (Next.js 16.4.4, React 19.3.0, Pages Router, initially clean `develop`) and explicitly requested Yarn for that website. Its Yarn 1.22.22 manifest/lockfile replace npm there only; backend/mobile package managers and source layouts are unchanged. The website now implements a SmartBord layout/home, signup/login, a protected account page, actual cookie/CSRF auth, serialized refresh and logout. [Website setup](../../smartbord-ai-frontend-web/README.md) and [dated verification](../../smartbord-ai-frontend-web/docs/Verification.md) describe its supported topology (same hostname, different HTTPS ports), commands and remaining acceptance.

Added only `scripts/browser-auth-host.ts` as backend executable test infrastructure. It creates the actual Nest AppModule with explicit temporary TLS, uses only the dedicated `MONGODB_TEST_URI`, generates an exact `sbt_<32 hex digits>` DB, verifies initial emptiness and prepares platform indexes. Synthetic access expiry/blocking uses private parent-process IPC guarded by exact DB identity, never an HTTP/GraphQL fixture route. Shutdown stops its loopback listener, drops only its owned exact DB and closes the app/connection. It refuses production mode; it creates no administrator or application record. Production auth/controller/schema behavior and ordinary host ports are unchanged.

Actual browser verification passed eight grouped scenarios using a production web build, Chromium 156, real MongoDB and strictly validated HTTPS (no ignore-certificate flags). Coverage includes anonymous protection; actual signup/login with USER role; secure host-only cookies/no credential JSON or JS cookie access; request-scoped SSR/no-store and anonymous-context isolation; CSRF/origin rejection; one refresh across two tabs with credential rotation/old-access denial; outage/retry; failed logout and real revocation/cross-tab logout; a committed refresh with a lost response requiring fresh login; current blocking; and safe rejection of browsers without Web Locks. The test CA was one-day, SSL-only, constrained by X.509 name constraints to localhost/127.0.0.1. The macOS trust dialog was approved. Initial canceled authorization, hostname-scoped trust incompatibility, missing Node test-client CA and an overbroad alert locator failed before the eventual passing run; all applicable owned resources were cleaned. The passed run confirmed exact DB removal, stopped both HTTPS hosts, removed its certificate/trust and deleted temporary keys. A subsequent keychain query found no test CA. Screenshots contain synthetic UI/accounts only; no lecture data or credential report was retained.

Backend regression checks passed: `npm run lint`, non-writing TypeScript inspection, `npm test -- --runInBand` (14 suites/77 tests), HTTP E2E (2 suites/18 tests), real MongoDB integration (4 suites/73 tests), Nest build and official Postman CLI (83 requests/322 assertions, zero failures). Each fixture used guarded disposable DBs and closed its own resources. Postman definitions/examples and generated GraphQL schema were unchanged. Website type/lint/build and browser results are recorded separately. All 71 local Markdown paths across nine task documents resolved. Task-source review, test-host formatting, final Yarn frozen offline install/type/lint/build, separate static mobile/desktop layout/keyboard/password-constraint QA and whitespace checks passed before commits. Temporary static-layout hosting was also closed.

This completes the website login increment only. Admin screens, native authentication/recovery UI, other browser engines, production hosting, phone storage/video, vision and deployment-wide retention remain pending. No native-file deletion or private lecture API was introduced. Current repo boundary documentation now records all three established repositories rather than presenting the website as unimplemented mobile work.

Changed backend files: `scripts/browser-auth-host.ts`, `AGENTS.md`, `README.md`, `contracts/authentication.md`, `docs/Backend_plan.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md`. No mobile repository files changed.

## 2026-11-02 — Correct ordinary web-development signup

The user reported signup refusal and a React title warning while running the website's old `yarn dev` command over HTTP. That command could not satisfy the existing exact HTTPS/cookie contract; the earlier production browser fixture had not provisioned ordinary local development. The separate website now defaults to an HTTPS web launcher and a local HTTPS API bridge, with opt-in ignored persistent localhost certificate setup. It requires the backend to be started separately on the documented explicit port 4001, leaving this application's default port and environment files unchanged. See the [corrected setup](../../smartbord-ai-frontend-web/README.md) and [verification](../../smartbord-ai-frontend-web/docs/Verification.md).

Backend changes are confined to `scripts/browser-auth-host.ts`: an explicit test-only HTTP mode allows the real development TLS bridge to be exercised against an initially empty exact disposable database. Its normal HTTPS mode, exact identity/emptiness guards, index preparation and cleanup remain. No production HTTP/auth/controller/schema behavior changed. The test still requires explicit TLS fixture paths and refuses production/application records. Existing user-started services were not stopped or used as fixtures; tests bind separate loopback ports and close their own app/connection.

Validation passed: backend lint, non-writing TypeScript inspection and unit tests (14 suites/77 tests); frontend source type/lint checks, production Next build, nine actual-browser scenarios through the development HTTPS bridge and nine against the production build. Both use real disposable MongoDB, exact cleanup guards and strict TLS validation with the configured local CA. Title/hydration warnings are checked in server/browser diagnostics. A new HTTP case verifies disabled credential fields and the correct HTTPS link. Earlier production checks exposed duplicate generated Next validators and a refresh-simulation teardown race; the duplicate dev validator is now excluded while production route validation remains, and the harness drains/catches its async route work before closing contexts. Parent-disconnect IPC is guarded after cleanup. Read-only dedicated-test metadata inspection after the interrupted run found no disposable DBs left. No real signup was submitted with the user's screenshot details and no administrator/application account was created. The developer CA is intentionally retained in the separate web checkout's ignored `.certs` and macOS user SSL trust after explicit authorization; it is constrained to localhost/127.0.0.1. Test databases/listeners and test-owned temporary files are removed, while that development setup remains usable for the user.

Final source/diff/whitespace and scoped Markdown-link checks passed. Application HTTP/GraphQL logic, authentication schema, Postman definitions and generated contracts are unchanged; their earlier full regression results remain historical and were not rerun for this test-host transport change.

Changed backend files: `scripts/browser-auth-host.ts`, `docs/Development_progress.md`. The web fix has a separate focused local commit; mobile is unchanged.

## 2026-11-02 — Persist local backend port and release the occupied web port

The user continued to receive the frontend launcher's clean port-3000 conflict. Read-only listener/cwd inspection identified backend app PID 74126 in this repository and its parent PID 74043 running the exact Nest `start --watch` command. The existing ignored backend `.env` had no PORT or browser-origin entry, so restarting the usual backend command kept selecting the source fallback 3000. No listener existed on 4001; a launcher code change could not release the backend's socket.

Saved only `PORT=4001` and `AUTH_BROWSER_ORIGINS=https://localhost:3000` into the existing ignored `.env`, with a line-for-line check preserving all unrelated content and credentials. Node's actual env-file loader verified those two settings without printing credentials. After rechecking both ownership and the watch command, gracefully terminated only the confirmed watcher and app. The subsequent listener inventory found 3000, 4000 and 4001 free. No unrelated process, account, record, index, database URI or frontend/native file was changed. The app's source fallback remains 3000.

The committed `.env.example` and README now explain the persistent local setting, so normal `npm run start:dev` no longer needs a repeatedly supplied inline override. The real ignored environment is not committed. Verification is operational configuration/ownership/socket inspection and documentation/link/whitespace review, rather than an authentication regression or real-account signup. No new service was left running by this fix. Changed tracked files: `.env.example`, `README.md`, `docs/Development_progress.md`.

## 2026-11-03 — F3 website administrator account management

Implemented the authorized admin account increment in the established separate Pages Router website. `/admin` leads to protected `/admin/users`, with current-account SSR, anonymous login redirection, USER denial, no-store/request-scoped identity and a browser loading shell for expired access. The website adds typed Apollo operations generated from its checked-in copy of the existing versioned schema, filtered pagination, confirmed USER/ADMIN changes and block/unblock, read-only deleted accounts, last-admin conflict feedback and self-change sign-out. Session validation/refresh, CSRF issuance and each complete GraphQL response share the existing browser lock. Directory data is not persisted/cached, denied revalidation clears it, and an uncertain mutation requires reconciliation instead of automatic replay. The backend's production routes, schema, policy transactions, ports, authentication and Postman definitions are unchanged.

The only backend executable change is explicit `BROWSER_TEST_ADMIN=1` support in `scripts/browser-auth-host.ts`. After verifying its generated exact `sbt_<32 hex digits>` database is initially empty and preparing indexes, it creates two synthetic administrators and 24 members through existing services in a policy-locked transaction, including bootstrap audit events. Only public fixture identities are sent over private parent IPC; synthetic passwords are derived in process memory. It accepts no arbitrary fixture details and adds no public fixture route. The test still refuses production, never falls back to application credentials, and drops only its owned exact database after stopping its listener. No actual administrator or application record was created/changed.

Validation passed: backend non-fixing lint, `tsc --noEmit --incremental false`, 14 unit suites/77 tests, 2 HTTP E2E suites/18 tests, 4 real MongoDB integration suites/73 tests, Nest build, and official Postman CLI (83 requests/322 assertions, zero failures). The first HTTP attempt was denied loopback binding by the sandbox; the permitted rerun passed. Integration/Postman fixtures closed their own connections/listeners and used guarded disposable databases; Postman confirmed exact removal. No application schema preparation, application CRUD, real account bootstrap or live Postman examples were run.

Website verification passed 19 real Chromium scenario groups in each transport: development HTTPS launcher/API bridge and production build/direct HTTPS API, both against real disposable MongoDB with strict certificate validation. Cases cover current roles and Next data/SSR isolation; pagination/combined filters/URL validation and obsolete responses; read-only deleted accounts; keyboard confirmation/cancel; block/reactivation and role-change session revocation; open-page permission loss; uncertain, committed-but-lost and successful-mutation/failed-refetch outcomes; empty-page correction; responsive layout; serialized refresh alongside GraphQL; cross-tab logout; self-block/demotion and last-admin conflicts; and two independent browser contexts racing self-demotion. One race mutation succeeded, one returned CONFLICT, and one active admin remained. Website frozen offline install, schema/generated consistency, type, lint, startup/socket tests and production build also passed. Desktop/mobile synthetic screenshots were visually inspected. See [website verification](../../smartbord-ai-frontend-web/docs/Verification.md) for the commands and browser limits.

An initial development race observer failed when successful self-demotion navigated away before Playwright read the response body. Its children shut down on parent disconnect; a subsequent read-only dedicated-test inventory found no remaining disposable databases or task test hosts. Its exact temporary synthetic-screenshot directory was removed; older/unrelated resources were preserved. The observer now captures actual response bodies before releasing them to the page. An initial production attempt also exposed an existing lost-refresh observer asserting before its isolated request completed; the harness now awaits bounded completion. Those attempts are not passing evidence. Successful runs confirmed exact database removal and stopped their own hosts; existing localhost certificate/trust and unrelated user-started development processes were preserved. No TLS bypass was used.

F3 remains in progress: help/FAQ and community are subsequent increments. B3/F1 physical-phone capture, app restart and reopening with the backend unavailable remain incomplete; phone setup is still deferred. No mobile file, private lecture content, phone credential adapter, vision service, deployment or push was included.

Changed backend files: `AGENTS.md`, `README.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md`, `scripts/browser-auth-host.ts`. The website has a separate focused local commit. Documentation links, complete task-source diff (including new files), artifact/credential review and whitespace checks were verified before committing.

## 2026-11-03 — F3 public Help, FAQs and announcements

Added a separated Help module with the versioned [Help contract](../contracts/help-center.md) and generated schema. `helpEntries` stores intentional platform text: FAQ/announcement kind, Markdown, topic, display order, DRAFT/PUBLISHED/ARCHIVED state, revision, author/editor IDs and timestamps. New entries always start as drafts. Current administrators can edit/publish/unpublish/archive/restore with expected revisions, a shared 20-write-attempt/account/minute limit, policy-lock current-role revalidation and transactional metadata-only audit. Restoring permits draft only; no physical deletion, attachment, scheduling or content revision archive exists. User-subject validation remains mandatory for existing audits; Help uses its own entry subject and stores no body/title in audit events.

Public `helpEntries` summaries and `helpEntry` detail use explicit credential-free `X-SmartBord-Client: public`, without cookies, Authorization, CSRF issuance or refresh. A bounded parsed-operation policy permits only the two published reader roots, including aliases/fragments. It rejects protected roots behind directives, mutations, mixed/multiple operations and introspection before execution. Browser origins remain exact, supplied credentials are rejected and the existing IP budget is shared with protected GraphQL traffic. Normal account/enrollment transport, CSRF and authorization remain unchanged. GraphQL JSON is now capped at 64 KiB and operation documents at 8 KiB; authentication JSON remains 8 KiB. Express 5.3.0 is declared directly for the route-specific JSON parser, matching the already installed/locked transitive runtime; no resolved package version changed.

`db:prepare` explicitly prepares the new collection/five indexes, without seeds or automatic startup setup. Help independently fails closed without those indexes. Core readiness scope is unchanged. Fixture hosts prepare Help only after exact owned-test-database/initial-emptiness checks. **Application setup, application content/records and real administrator bootstrap were not run or changed.** The application operator must prepare indexes before using the new surface there; prior application metadata/policy findings remain historical/latest evidence.

The separate website now provides public `/help` and `/help/[id]`, protected `/admin/help`, topic/state/kind filters, pagination, accessible FAQ expansion, a Markdown editor/preview, confirmed live publication changes and read-only archive viewing/restore. Public DTOs exclude unpublished metadata/authors/revisions; draft/archived/missing details are indistinguishable publicly. Public reads omit credentials and use uncached fixed-origin requests. Preview and readers share a restricted renderer without HTML/images/embedded media/MDX. The reusable admin layout preserves editor buffers during successful same-actor checks, clears them on invalidation/logout and reliably warns before navigation discards edits. Uncertain writes require reconciliation; revision conflicts require reload rather than overwriting another editor.

Validation passed: non-fixing backend lint with no warnings, non-writing TypeScript inspection, 16 unit suites/93 tests, 2 HTTP E2E suites/18 tests, 5 real MongoDB integration suites/87 tests, Nest build and existing official Postman CLI regression (83 requests/322 assertions, zero failures). The 14 new Help integration cases cover public projections/draft exclusion, protected/tampered operations, aliases/fragments/directives, origin/credential rejection, UTF-8/request limits, pagination/order/topics, live edits/archive/restore, no-ops/revisions, concurrent editors and account revocation, atomic audit rollback, missing-index failure/recovery, write budget and content surviving a real backend app restart in its owned disposable database. Prior authentication, account, recovery and enrollment suites remain passing.

Website validation passed: frozen offline Yarn install, schema/snapshot/generated consistency, type/lint checks, three startup/socket cases, production build and 27 grouped strict-HTTPS Chromium scenarios in each development/production transport. The eight new Help groups cover anonymous reading with no cookies; USER/admin permissions and draft hiding; publish/live-edit/unpublish/archive/restore; safe Markdown and no remote-image/script execution; unsaved state/reliable cancelled navigation; concurrent revision conflict/reload; aborted and committed-but-lost mutation reconciliation plus answer outage/retry; current admin revocation clearing the editor; and responsive UI/storage isolation. Production additionally verifies read-only archived Markdown viewing. Synthetic desktop/mobile/editor screenshots were visually inspected; the final ordinary build restored configured development origins. See [website evidence](../../smartbord-ai-frontend-web/docs/Verification.md).

Earlier browser attempts exposed a navigation ordering bug and then a transient dirty-state/reset interaction; the fix intercepts links before Next navigation, uses the layout's cancelable guard and forces protected editor resets even when identity updates are batched. Native-dialog observers now foreground the page and await exactly one confirm. An overbroad alert locator also matched Next's route announcer and was scoped to main content. These failed attempts are not passing evidence. One early dialog-handler rejection terminated the parent; children clean up on disconnect. Later successful runs confirmed exact DB removal and task-host shutdown; a final read-only dedicated-test metadata/process check and cleanup of that run's exact synthetic-screenshot directory verify the interrupted resources too. Existing developer TLS trust/files, unrelated user processes and older unrelated temporary resources were preserved. No TLS bypass or relaxed rate limit was used.

Dependency audit remains a separate non-passing check: installation reports the existing 28 findings (6 low, 18 moderate, 4 high). Read-only runtime audit reports two high findings in the existing Nest platform-express/Multer chain ([advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)). All resolved backend package versions are unchanged from the prior lockfile. This increment adds no multipart/upload route and performs no force fix or unrelated framework upgrade; prior production-acceptance limitations remain.

Community is the next F3 content increment. B3/F1 physical-phone capture, restart and backend-unavailable reopen proof remains incomplete and phone setup remains deferred. No mobile changes, real content seeds, deployment or push occurred. Source/new-file, link/path, credential/artifact, staged-diff and whitespace review precedes focused local commits in both repositories.

Changed backend files: `AGENTS.md`, `README.md`, `contracts/authentication.md`, `contracts/help-center.md`, `contracts/platform-accounts.md`, `contracts/schema.graphql`, `docs/Backend_plan.md`, `docs/Database_setup.md`, `docs/Development_progress.md`, `docs/Frontend_plan.md`, `package-lock.json`, `package.json`, `scripts/browser-auth-host.ts`, `scripts/generate-schema.ts`, `scripts/lib/postman-host.ts`, `scripts/prepare-database.ts`, `src/app.module.ts`, `src/app.setup.ts`, `src/graphql/platform-graphql.module.ts`, `src/graphql/public-help-policy.spec.ts`, `src/graphql/public-help-policy.ts`, `src/modules/audit/audit.service.ts`, `src/modules/audit/schemas/audit-event.schema.spec.ts`, `src/modules/audit/schemas/audit-event.schema.ts`, `src/modules/auth/auth-transport.service.ts`, `src/modules/help-center/dto/help.dto.ts`, `src/modules/help-center/help-schema.service.ts`, `src/modules/help-center/help.module.ts`, `src/modules/help-center/help.resolver.ts`, `src/modules/help-center/help.service.ts`, `src/modules/help-center/schemas/help-entry.schema.ts`, `test/help-center.integration-spec.ts`.

## 2026-11-03 — F3 community posts V1

Implemented a separate Community module and [versioned contract](../contracts/community.md): two credential-free published readers, owner list/detail/create/update and administrator list/detail/moderation at `/graphql`. Creation saves a disclosed server draft; only the owner edits, explicitly publishes or withdraws. Chosen per-post public names are editable and public projections exclude account IDs/emails, revision and moderation metadata. Public summaries omit bodies. Removed/draft/missing valid IDs are indistinguishable publicly. General community text is entered separately; no recording/file/transcript importer, attachment, device-local ID or media endpoint exists.

DRAFT/PUBLISHED/REMOVED state and expected revisions protect author changes and moderation. Administrators may inspect saved drafts, remove with a coded reason and restore only to draft; they cannot rewrite/publish another author's post. Removed posts remain owner-readable with their reason and block owner writes until restoration. Withdrawal/removal retain server text; there is no permanent deletion, content history, comments, reports, reactions or search in this increment. Blocking revokes account access but does not automatically hide published text. Live edits retain publication time; republication resets it. Lists use existing pagination bounds and deterministic UUID tie-breaks.

All community writes share 20 service-reached attempts/account/minute and reauthenticate under the existing policy lock inside the transaction, including author writes racing blocking and moderation racing demotion. Actual changes atomically audit actor/post/action/state/revision/reason only; no title, body or public name is copied to audit. Audit failure rolls back content. Existing user-subject validation remains mandatory for previous audit actions. Public parsing adds only the two community roots alongside Help; aliases/fragments/directives, credential/origin rejection and document/request budgets retain their restrictions.

Explicit setup now adds `communityPosts` and five indexes, with fail-closed per-feature preparation checks and no startup seeds. Browser/Postman fixture hosts prepare it only in exact, initially empty disposable databases. The private browser IPC can remove/restore one fixed community index for real outage/retry verification after exact DB/mode/ID checks; there is no production fixture route or caller-selected database/index. Core readiness still certifies only its prior scope. **Application `db:prepare`/CRUD, real administrator bootstrap and production setup/deployment were not performed.** Help rollout remains a separate operator task: prepare and verify its indexes before updating running backend/website. Community similarly requires release-tooling index preparation/verification before rollout; prior application metadata/policy evidence remains unchanged.

The separate website now implements `/community`, `/community/[id]`, `/account/posts` and `/admin/community`, generated operations, safe Markdown, publication/moderation confirmations and in-memory editor buffers. It reuses the current auth/CSRF lock and protected lifecycle for active authors as well as administrators. Protected post data does not enter SSR props or persistent browser storage. Conflicts require reload; uncertain writes are not replayed and require read-only directory reconciliation. Known success and failed refetch remain distinct. See [website evidence](../../smartbord-ai-frontend-web/docs/Verification.md).

Validation passed: backend non-fixing lint without warnings, `tsc --noEmit --incremental false`, 16 unit suites/98 tests, 2 HTTP E2E suites/18 tests, 6 real MongoDB integration suites/103 tests (16 community cases), Nest build, schema generation/actual-schema consistency and the existing official Postman CLI regression (83 requests/322 assertions, zero failures, exact database removal confirmed). Community integration cases cover public projection/visibility, owner IDOR, role/session rejection, unknown/forged/null inputs, UTF-8 limits, publication/removal rules, deterministic pagination/filtering, no-ops/revisions, racing author/moderator writes, audit rollback, missing-index re-preparation, shared write budget, blocking/demotion races and a real backend restart. Tests used only owned `sbt_<32 hex digits>` fixtures; application data was not used.

Website validation passed type/lint/schema-generated checks, three startup/socket cases, production build and 38 grouped strict-HTTPS Chromium scenarios in each transport: development launcher/API bridge and production build/direct HTTPS API. The 11 community groups add route/SSR/CSRF protection, explicit server drafts, editable attribution and byte limits; public credential/metadata isolation; publish/live-edit/withdrawal/republication; reasoned removal/locking/restore; dirty-state revalidation/cancelled navigation; revision conflict/reload; aborted and committed-but-lost writes with reconciliation and failed-refetch distinction; real missing-index public list/detail outages/retry and responsive/storage/network checks; account/admin revocation; and cross-tab logout clearing unsaved author content. Existing 27 auth/Help/admin groups remain included. Public reads issued no cookies and no media upload or authored remote-image request was observed. Synthetic desktop/mobile/editor screenshots were visually inspected. Final ordinary website build restored normal configured origins. Temporary hosts/connections and exact fixture databases were cleaned up; existing local certificate/trust and unrelated user processes were preserved.

Failed attempts are not passing evidence. Initial sandbox-only database/socket runs failed and passed with permitted network/loopback access. Browser iteration corrected a live-edit completion wait, explicit Cancel focus in the reason-selector dialog, and the reason locator. An initial production run hit an existing signup observer reading after navigation; it now reads the actual response before releasing it. An intermediate development run lost the administrator directory during the self-blocking group; credential-free diagnostics were added, and the final complete run passed. No failure was resolved by weakening TLS/authentication, relaxing budgets, skipping assertions or changing application records.

This completes community posts V1 only. Comments/reports, other browser engines, production hosting/proxy/TLS, deployment-wide retention and native features remain unverified or deferred. Existing dependency advisory findings are unchanged. B3/F1 real-phone capture, restart and backend-unavailable reopen proof remains incomplete. No mobile files, private lecture content, production rollout or push were included.

Changed backend files: `AGENTS.md`, `README.md`, `contracts/authentication.md`, `contracts/community.md`, `contracts/help-center.md`, `contracts/platform-accounts.md`, `contracts/schema.graphql`, `docs/Backend_plan.md`, `docs/Database_setup.md`, `docs/Development_progress.md`, `docs/Frontend_plan.md`, `scripts/browser-auth-host.ts`, `scripts/generate-schema.ts`, `scripts/lib/postman-host.ts`, `scripts/prepare-database.ts`, `src/app.module.ts`, `src/graphql/public-help-policy.spec.ts`, `src/graphql/public-help-policy.ts`, `src/modules/audit/audit.service.ts`, `src/modules/audit/schemas/audit-event.schema.spec.ts`, `src/modules/audit/schemas/audit-event.schema.ts`, `src/modules/community/community-schema.service.ts`, `src/modules/community/community.module.ts`, `src/modules/community/community.resolver.ts`, `src/modules/community/community.service.ts`, `src/modules/community/dto/community.dto.ts`, `src/modules/community/schemas/community-post.schema.ts`, `test/community.integration-spec.ts`. The website has a separate focused local commit. Complete changed/new-source, contract/link/path, credential/artifact and whitespace review precedes commits.

## 2026-11-08 — F3 community comments and reports

Added flat comments in the Community module and a separate Reports module, generated GraphQL contracts and explicit additive preparation for `communityComments`/`reports`. Comment creation is an explicit publication, with chosen public attribution, a 4096-byte Markdown limit, no attachment/reply/private lecture field and no new-comment server draft. Owners edit/withdraw/republish with expected revisions; removed comments remain readable with reasons and are locked until administrator restoration to draft. Editing/publication/reporting require a published parent; a state-only owner withdrawal remains available after the parent is hidden. Public comments and parent visibility share one aggregation, including empty results. Blocking does not automatically hide published text.

Reports accept POST/COMMENT targets and reason codes only, never free text or media. A published target and published parent are checked transactionally. A unique non-sparse/non-partial reporter/type/target index and policy-serialized duplicate checks enforce one retained report per account/target, including after review. Reporter history is owner-scoped; administrative review lists all reports, with no reporter/moderator account IDs or target text snapshots in DTOs. OPEN reports become RESOLVED or DISMISSED with expected revisions. Reports/outcomes never automatically hide text: current target inspection, reasoned content moderation and report review are distinct actions.

All writes reauthenticate under the existing shared policy lock, serializing against blocking/demotion and parent/post moderation. Posts/comments/reports share 20 service-reached write attempts/account/minute; report submission also uses 10/account/minute. Actual changes and dedicated metadata-only audit subjects commit atomically. Audit failures roll back; comment no-ops do not audit. Public mode adds only `communityComments` to the prior four allowed roots; protected report/owner/admin roots remain forbidden even behind fragments/directives. Request/cookie/CSRF/document limits and core readiness scope are unchanged. Feature indexes independently fail closed. No runtime dependency or lockfile change was needed.

Reference inspection was read-only: TripLink comment module/resolver/service and input/update DTOs, plus Nestar website comment operations/detail handler. Adapted service/guard/DTO separation, owner checks and same-operation parent visibility; did not import reference IDs, pagination, profile joins, physical deletion or unrelated business rules. Reports have no equivalent in the inspected reference inventory; this project's plans and existing account/content transaction boundaries informed the implementation.

The separate website adds public paginated discussion and protected write/report links; `/account/comments`, `/account/reports`, `/admin/comments` and `/admin/reports` reuse account/admin lifecycle and generated no-cache operations. Comment/report forms disclose public publication and retained server text. The report queue inspects exact current target content, supports separate removal/restore-to-draft and records review outcomes. Restricted Markdown disallows HTML/images/embedded media. Unsent text remains in memory, warns before navigation and clears on identity revocation/logout. Uncertain/stale writes lock mutations until read-only reconciliation; known save success with failed directory reload has distinct feedback. No protected discussion text is serialized into SSR props or persistent browser storage.

Validation evidence: non-fixing backend lint, non-writing TypeScript inspection, 16 unit suites/103 tests, 2 HTTP E2E suites/18 tests, Nest build and schema generation passed. The full MongoDB regression passed 7 suites/120 tests, including the initial 17 discussion cases; the final uniqueness-index hardening added a partial-uniqueness rejection case and its complete discussion suite passed 18 tests after the change (including real MongoDB cleanup). Official Postman CLI regression passed 83 requests/322 assertions with zero failures and exact fixture cleanup. Initial sandbox database/socket attempts failed for permissions; permitted runs passed. All database fixtures are initially empty exact `sbt_<32 hex digits>` databases, never application records.

Full website `yarn test:web --dev --local-cert --discussion` and production `yarn test:web --local-cert --discussion` each passed 52 grouped Chromium scenarios: the prior 38 auth/admin/Help/post groups plus fourteen discussion groups. Both used strict certificate verification, actual Nest/MongoDB, unchanged budgets and exact disposable cleanup. Production used an isolated ignored build directory. The focused development command passed 23 groups twice, with the final run additionally asserting the mobile Publish control and preview before screenshot capture; it used its own isolated cache. Public discussion, report queue and the settled mobile editor screenshots were visually inspected. The first mobile full-page capture omitted paint below the textarea; explicit scrolling/control checks produced a complete capture without a product change. Website type/lint/generated-schema consistency, three startup/socket cases and the final normal-origin production build passed. All temporary hosts/connections/browser contexts stopped; exact fixture database removal was confirmed. Existing certificate/trust and unrelated user processes were preserved. A first development browser attempt stopped at the report-reason selector; explicit accessible select names fixed the issue. That failed attempt confirmed its own host/database cleanup and is not passing evidence. An extra concurrent mobile QA launch exited before ready while sharing the active development cache setting; its own exact database/host cleanup was confirmed. The harness now honors an explicit separate development build directory. The expanded browser mode keeps a bounded 30-minute fixture lifetime for conservative rate-limit pacing (15 minutes otherwise); its private IPC only removes/restores fixed known comment/report indexes after exact fixture/mode/ID checks. No production fixture route exists.

Application `db:prepare`/CRUD, real administrator bootstrap, content seeds, deployment and push were not performed. Release setup must explicitly prepare/verify Help/post/comment/report indexes before updating running services. Prior application policy findings and dependency advisories remain unresolved acceptance limits. B3/F1 physical-phone capture/restart/backend-unavailable reopen proof remains incomplete and phone setup remains deferred. Native authentication/video, AI, exports, other browser engines and deployment-wide no-retention remain outside this evidence. No mobile files or private lecture content changed.

Exact changed backend files:

```text
AGENTS.md
README.md
contracts/authentication.md
contracts/community-discussion.md
contracts/community.md
contracts/help-center.md
contracts/platform-accounts.md
contracts/schema.graphql
docs/Backend_plan.md
docs/Database_setup.md
docs/Development_progress.md
docs/Frontend_plan.md
scripts/browser-auth-host.ts
scripts/generate-schema.ts
scripts/lib/postman-host.ts
scripts/prepare-database.ts
src/app.module.ts
src/graphql/public-help-policy.spec.ts
src/graphql/public-help-policy.ts
src/modules/audit/audit.service.ts
src/modules/audit/schemas/audit-event.schema.spec.ts
src/modules/audit/schemas/audit-event.schema.ts
src/modules/community/comment-schema.service.ts
src/modules/community/comment.resolver.ts
src/modules/community/comment.service.ts
src/modules/community/community.module.ts
src/modules/community/dto/comment.dto.ts
src/modules/community/schemas/community-comment.schema.ts
src/modules/reports/dto/report.dto.ts
src/modules/reports/report-schema.service.ts
src/modules/reports/reports.module.ts
src/modules/reports/reports.resolver.ts
src/modules/reports/reports.service.ts
src/modules/reports/schemas/report.schema.ts
test/discussion.integration-spec.ts
```

## 2026-11-08 — Application schema preparation and local website smoke check

Completed the explicitly authorized application preparation after the comments/reports feature commits. The pre-check found `SmartBoardAI` reachable/transaction-capable with 8 collections, including the known unexpected empty collection. `npm run db:prepare` passed, additively preparing all eleven platform collections/indexes without account/content seeds, administrator bootstrap, record overwrites or index/data deletion. Existing administrator policy revision and ignored environment settings were preserved.

Read-only assertions passed for authentication, recovery, enrollment, Help, community posts, comments and reports. Index totals including `_id`: helpEntries 6, communityPosts 6, communityComments 7, reports 6. The post-check found 12 total collections, 1 unexpected collection and 0 unexpected nonempty collections. Its exit 1 still represents the preserved empty policy finding, not a setup failure or clean policy pass. The first sandbox DB check failed; the permitted network rerun succeeded in reaching the database. All owned application contexts/connections closed.

Strict-HTTPS Chromium smoke verification passed against the existing local project hosts: liveness/readiness 200; public FAQ/announcement/community pages 200 with expected headings; public Help/post GraphQL success; valid missing-parent comments NOT_FOUND; public report access 401; no public credentials/cookies; and four anonymous owner/admin comment/report routes redirecting to login. No actual account or content fixture was created/changed; ordinary request rate-limit metadata is part of these real reads. This verifies public serving and anonymous protection after application setup, not authenticated publishing against application records.

The initial temporary-host smoke attempt exited at its port preflight because existing project hosts already occupied 3000/4000/4001. No task listener started. Read-only working-directory inspection confirmed their project ownership; the successful check reused them without stopping or modifying their owners. The owned browser closed. Existing localhost certificates/trust and unrelated processes were preserved. See [database setup evidence](Database_setup.md) for exact scope and observations.

Changed files: `AGENTS.md`, `README.md`, `docs/Database_setup.md`, `docs/Development_progress.md`. This task changes operational records only; no source, dependency, schema contract or website file changed. Documentation path/link/diff/whitespace and staged artifact review are required before the focused local commit. Earlier implementation validation remains historical and was not rerun as if application tests were needed for this documentation update. Physical-phone proof, real-account manual publishing, production deployment, existing dependency advisories and the empty policy finding remain outside this acceptance.

## 2026-11-08 — Fix first-bucket rate-counter concurrency

The recovery UI regression exposed a failure in the existing overlapping device-revocation test (initial complete run: 120 passed, one failed). Its original boolean assertion did not expose the response code, and a focused repetition passed. Direct real MongoDB concurrency tests then reproduced a concrete counter issue: same-bucket conditional upserts could race their first insert and falsely reject requests whose combined/weighted cost still fitted the maximum. The old duplicate-key handler always returned 429.

On that duplicate-insert outcome only, the limiter now tries one non-upserting increment using the identical counter ID and `count <= maximum - cost` filter. Success accepts the previously uncharged attempt; no match still rejects with 429. Scope hashes, TTL/windows, maximums, weighted charges and other error handling are unchanged. No authentication/reset HTTP request is retried. Device-race diagnostics now expose safe status/code/success only and retain the original success/timestamp/audit assertions.

Validation passed: lint, non-writing TypeScript, 103 unit tests, Nest build, targeted rate/device integration (28 tests), final full integration (8 suites/124 tests), and final official Postman CLI regression (83 requests/322 assertions, zero failures). HTTP E2E passed 18 tests during the increment. Three new real concurrency cases cover repeated fresh-bucket bursts, weighted exact capacity and strict full-bucket rejection. The initial direct counter run failed two cases before the fix; failures are retained as failure evidence, not passes. Tests used only exact guarded disposable databases and closed/dropped their own resources. No application records or credentials were used as fixtures.

Changed files for this focused fix: `src/modules/auth/auth-rate-limit.service.ts`, `test/auth-rate-limit.integration-spec.ts`, `test/device-enrollment.integration-spec.ts`, `docs/Rate_limit_verification.md`, and this record. See [detailed rate evidence](Rate_limit_verification.md). Recovery UI/test-host work is a separate focused change.

## 2026-11-08 — Website operator-assisted password reset

The separate Pages Router website now provides `/reset-password`, linked from login, to consume the existing operator-issued recovery code. It adds local password confirmation, masked code entry, secure-origin gating, explicit POST fallback, empty/no-store SSR, query stripping and fragment disposal without credential prefill. Codes/passwords are never stored in React state, page props, browser storage or URLs, and fields clear after server attempts/history/session notifications. Operator ownership verification and private delivery remain required; there is no web issuer, email-request flow or automatic login.

The new client function reuses the existing cross-tab auth lock for CSRF issuance and the full reset response, without `/me` or refresh. Success clears cookies through the backend, broadcasts invalidation and requires ordinary login; all target sessions are revoked, while other accounts' independent sessions and device files remain intact. Invalid/expired/used/superseded/inactive codes have one generic response. Pending submissions cannot repeat. Unknown/5xx/lost responses lock the form without replay, recommend trying normal login or obtaining a newly issued code, and retain only the existing credential-free uncertainty marker. Deterministic 4xx errors restore a pre-existing marker rather than clearing unrelated refresh uncertainty.

Only the test-only `scripts/browser-auth-host.ts` changed in backend behavior for this feature: explicit recovery mode creates three fixed synthetic identities after exact initially empty disposable DB checks, and can privately issue/expire proofs only for those whitelisted IDs through parent IPC. Proofs remain in process memory and the intended reset body, never CLI arguments, logs or artifacts. There is no new production controller/resolver or fixture route. The separate rate-counter correction is committed as `fix: preserve rate budgets across concurrent bucket inserts`; see [its evidence](Rate_limit_verification.md).

Verification: both strict-HTTPS `--recovery` browser transports passed 20 grouped scenarios (nine auth plus eleven recovery), repeated successfully with the final explicit-POST check. Cases cover local validation/no request and secret clearing; generic proof failures/expiry/supersession/reuse; actual reset, cross-tab/independent target session revocation, cookie clearing, preserved password spaces and normal login; reset from a different account without revoking its independent server sessions; real CSRF rejection and ADMIN reset; real proof-budget exhaustion; pre-POST outage versus synthetic 503; aborted and real committed-but-lost responses without replay; inactive-account rejection and missing Web Locks sending no credentials; HTTP-disabled fields, no secret URL/storage/SSR data and responsive controls. All owned hosts/connections/browser contexts and exact disposable DBs were cleaned up. Existing development hosts/certificates/trust were preserved.

Website type/lint/generated-schema checks, three startup/socket cases and an isolated normal-origin production build passed. Blank desktop/mobile screenshots were visually reviewed; mobile heading whitespace was corrected and then checked separately on the existing local website with an owned anonymous browser. That read-only check confirmed POST, empty fields, no overflow, readable heading and no auth requests/cookies; no code was submitted. The initial browser attempt failed due a locator also matching Next's route announcer; scoping it to main content corrected the assertion, with cleanup confirmed for the failed attempt. Earlier syntax/format correction before execution is not test success evidence. No assertion, TLS setting, code policy or rate budget was relaxed.

Backend final lint/type/build passed, unit 103, HTTP 18, full real MongoDB integration 124 across eight suites, and Postman CLI 83 requests/322 assertions with zero failures. The initial full regression's existing device-race failure and the two direct counter failures are documented separately from these final passes. No actual application-account proof issuance/reset, application content fixture, real administrator bootstrap, phone file change, deployment or push occurred. Human verification/delivery, clipboard/email handling, native recovery UI, other browser engines and production hosting remain unverified or deferred. Existing application policy findings/advisories and B3/F1 physical-phone gate remain unchanged.

Changed backend files for this recovery feature: `AGENTS.md`, `README.md`, `contracts/password-recovery.md`, `docs/Frontend_plan.md`, `docs/Development_progress.md`, `scripts/browser-auth-host.ts`. The website's exact file inventory and scoped evidence are in [website verification](../../smartbord-ai-frontend-web/docs/Verification.md). Dependency locks and GraphQL schema/operations are unchanged. Documentation paths, source/new-file, staged artifact/credential, diff and whitespace review precede focused local commits in each changed repository.

## 2026-11-08 — Username or email login

Added separate unique normalized usernames while preserving full names, public community names and existing email login. Website signup requires a username; HTTP signup keeps it optional for older clients. Existing owners choose once on /account through protected `setMyUsername`; no backfill or automatic assignment occurs. The mutation reauthenticates inside the shared policy transaction, audits once, is idempotent for the same username, rejects renames/collisions, and preserves password/status/role/auth-version/recovery/sessions. Email/username aliases share one five-attempt account login budget; the IP budget remains twenty/minute. The new additive unique sparse username index is required for auth/readiness and was prepared in the application database without account rewrites.

Backend checks passed: TypeScript, lint, 103 unit, 18 HTTP, build, schema generation, 135 real-MongoDB integration tests across nine suites, Postman 83 requests/322 assertions with zero failures. All test CRUD used guarded disposable databases. Separate read-only application schema assertions passed; the known unexpected empty-collection policy finding remains. Initial test assertion, sandbox and browser harness failures are retained in [username verification](Username_verification.md); final website browser results and exact changed paths are in [website verification](../../smartbord-ai-frontend-web/docs/Verification.md). No real account username was set, administrator bootstrapped, application content seeded, phone data changed or production service deployed.

Backend feature paths: `src/contracts/username-v1.ts`, `src/contracts/auth-v1.ts`, member schema/service and new `dto/username.dto.ts`, `username.module.ts`, `username.resolver.ts`, `username.service.ts`; auth DTO/service/controller/schema; Account DTO; audit service/schema; AppModule; schema generator/artifact; `test/username.integration-spec.ts`; `contracts/usernames.md`, authentication/account contracts; README, AGENTS, database setup, backend/frontend plans and dated verification/progress. Website inventory is recorded separately. Focused local commits include reviewed source, tests, contracts and docs; no generated build/private data/credentials are staged.

## 2026-11-08 — Stabilize administrator rate-limit fixture at minute boundaries

The taken-username feedback regression initially passed 135/136 integration tests, with one administrator rate-limit assertion expecting 429 but receiving 200. That existing fixture filled only the minute sampled before its database write; a request crossing into the next minute can legitimately use an empty bucket. The fixture now fills the current and following minute with the same existing 60-request maximum and a three-minute TTL, following the established disposable-fixture pattern. It explicitly checks the exact test database before writing. The rejection/code and allowed-collection assertions remain unchanged; runtime limits and production code are untouched by this correction.

Focused real-MongoDB administrator verification passed all 14 cases after the correction. Type/lint and whitespace checks passed before its separate focused local test commit. A complete integration rerun is grouped across the same nine suites for the signup feature record. The initial failed run is retained as failure evidence. Only `test/admin.integration-spec.ts` and this progress entry belong to this fixture fix; application records and other repositories are unchanged by it.


## 2026-11-08 — Clear taken-username signup feedback

A confirmed username unique-index collision now returns safe HTTP 409 USERNAME_TAKEN with “This username is already in use. Please choose a different username.” The website maps only that whitelisted signup code to the fixed instruction and keeps the form details for an edited username and deliberate resubmission. Duplicate-email conflicts stay generic, and no account details or raw database messages are returned. Database uniqueness remains authoritative for concurrent/case-normalized attempts. No schema/index, availability endpoint, polling, automatic retry or application setup/backfill was added.

Validation passed: backend type/lint/build, 103 unit, 20 HTTP, official Postman CLI 83 requests/322 assertions, and final complete integration coverage of 136 tests in nine suites, rerun in three nonoverlapping groups. Both strict-HTTPS browser transports passed 26 grouped scenarios, including the new exact-message/preserved-details/different-username success case; website type/lint/generated-schema/build and three startup checks passed. The initial complete integration run passed 135/136, exposing the existing single-minute administrator rate-fixture assumption; its separate correction is committed as 7919283 and its focused 14-case check passed. No assertion or application limit was weakened. See [detailed username evidence](Username_verification.md) and [website verification](../../smartbord-ai-frontend-web/docs/Verification.md).

All test CRUD remained inside exact initially empty disposable databases; owned test hosts/connections were closed and their databases removed. Existing user hosts/certificates and actual accounts/content/phone files were preserved. No production deployment or push occurred. Backend changed paths are listed in the detailed evidence; website commit 1b0060d contains only its signup client, browser test and associated documentation. The GraphQL schema and dependency locks are unchanged.

## 2026-11-08 — Android photo storage proof and mobile startup fix

The user connected a physical Samsung SM-S908N / Android 16 (API 36) phone. The separate mobile foundation APK installed, but its first physical startup exposed a SQLite initialization failure that disabled the lecture-name field. The mobile fix uses the query API for the row-returning WAL PRAGMA, then executes the FULL synchronous setting separately. Two new regression tests failed before the correction; mobile type/lint, all 17 tests, browser fallback/privacy verification, Vite build, native synchronization and Android debug build then passed. The corrected APK was installed with data preserved. The mobile source, tests and dated evidence are committed as `948b2b3` in `../SmartBord-AI-frontend`.

The user confirmed creating a lecture, taking/saving/opening a real photo offline, then reopening the same original after a forced app restart. ADB confirmed airplane mode on and Wi-Fi off, no app process after force-stop, and a subsequent COLD launch. The photo display is user-observed evidence on the phone; the app's existing open-original path verifies local file size/SHA-256. No phone photo/catalog was copied to the Mac or backend. The temporary debug forward and test preview listener closed; the task-started ADB server was stopped. Existing user-owned Mac project hosts were preserved and remained running: the phone was disconnected from the backend, rather than an actual server-shutdown test.

This establishes the core Android photo save/cold-restart/offline-reopen result. Full B3/F1 acceptance remains incomplete: iPhone, physical permission/cancellation, full-storage and interrupted-save recovery, OS backup/restore, video, native authentication/logout file preservation and deployment-wide retention remain unverified. See the [mobile verification record](../../SmartBord-AI-frontend/docs/Verification.md) for APK checksum and exact boundaries. No backend application source, schema, dependencies, database records or website files changed. Backend changed files are `AGENTS.md`, `README.md`, `docs/Frontend_plan.md`, and this progress record; documentation/link/path/diff/whitespace checks apply, with no backend server startup or unnecessary backend application regression run.

## 2026-11-08 — Android photo cancellation and background/return evidence

Continued user-guided physical checks on the same Samsung SM-S908N / Android 16 phone and the installed mobile startup-fix APK. The user confirmed that cancelling the camera left the capture count unchanged and the existing original readable. After backgrounding/returning, the user saved a second non-sensitive photo and confirmed both originals opened offline. ADB confirmed airplane mode on and Wi-Fi off before and after these checks; the task-started ADB server was stopped afterward. No phone photo/catalog was copied, no app data was cleared and existing user-owned Mac hosts were untouched.

The detailed [mobile verification record](../../SmartBord-AI-frontend/docs/Verification.md#2026-11-08--android-camera-cancellation-and-backgroundreturn-checks) distinguishes the directly confirmed count/original results from cancellation message wording that was not separately confirmed. Ordinary background/return is verified; active-camera/save interruption, permission denial, disk full, OS backup/restore, iPhone and video remain unverified. Mobile evidence is committed as `2834ba2`. Native video recording/recovery is the next implementation increment; this task did not add it.

Only `docs/Development_progress.md` changed in this backend repository; only the verification document changed in the mobile repository. Documentation links/paths, diff and whitespace checks apply; no backend or mobile application regression suite/build was rerun for unchanged source. No application server was started and no application database was mutated by this verification increment.
