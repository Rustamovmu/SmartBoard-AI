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
