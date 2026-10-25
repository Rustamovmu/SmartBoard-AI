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
