# Platform database setup and validation

The application uses the dedicated `SmartBoardAI` MongoDB database. Private lecture data is prohibited; see [storage policy](../contracts/storage-policy.md).

## Credentials and startup

The user has already created the database and configured its SRV connection in ignored `.env` as `MONGO_DEV`. Keep that file private and untouched by Git. Development accepts `MONGO_DEV`; the preferred key is `MONGODB_URI`, which takes precedence and is required in production. The URI database must be `SmartBoardAI` or omitted; the code explicitly selects that database. Do not reuse another project's database.

All npm start variants and `db:check` load `.env` if it exists. Existing process environment variables win. Tests do not load it. The app fails startup with a safe fixed error when configuration is missing or the initial connection fails; it does not start an unauthenticated replacement service or create a fallback database. The connection factory sanitizes failures before Nest can log them and closes failed connections.

In Atlas, grant the application only the intended platform-database permissions and allow the development host's actual network address. Do not broadly expose MongoDB. No Docker database is required for this supplied connection. No credentials, hosts or raw driver errors are printed by the diagnostic.

## Read-only diagnostic

```bash
npm run db:check
```

The command opens one bounded Mongoose connection, checks ping/topology, lists collection metadata, counts up to one document in each unexpected collection without returning its contents, and closes its connection. It does not create/delete collections or mutate any records. No HTTP server starts. It prints:

- `database`: selected application/test database name.
- `platformDatabase`: `up` or `down`.
- `transactions`: `supported`, `unsupported` or `unknown`, based on topology/session/wire-version capabilities.
- `collectionCount`, `unexpectedCollectionCount`, `unexpectedNonemptyCollectionCount`: numeric policy observations, without collection names or content.

Exit 0 means all these checks pass and collection names fit the policy. Exit 1 means a connection/probe failure, unsupported topology or unexpected collection. Ping/hello do not prove create/update/index/transaction permissions. Those require future tests against an isolated disposable database. An allowed collection name alone does not prove its schema/content is safe.

On 2026-10-25, live read-only verification reached `SmartBoardAI`, found transaction-capable topology and one unexpected **empty** collection. The command correctly exited 1 for that policy finding. No documents were returned; no application collections were changed or removed. Leave the pre-existing collection intact unless the user explicitly authorizes a specific cleanup. Identity development can continue with explicit allowed schemas, but the clean policy check remains unresolved.

## Application connection behavior

Automatic collection/index creation, Mongoose debug output, command monitoring and command buffering are disabled. Connection/server-selection/socket timeouts are 5 seconds, maximum pool size 10. Readiness probes use 2-second command timeouts. The app closes its own connection on shutdown. Initial connection failure is terminal; after an established connection loses connectivity, the driver can reconnect and readiness reports failure until checks recover. The connection factory still creates no records/indexes automatically. The auth increment adds an explicit `npm run db:prepare` command for `users`, `authSessions`, `authAttempts`, `auditEvents`, `platformSettings`, `devices`, `pairingRequests` and declared indexes; it initializes the singleton administrator policy if absent; it drops nothing and creates no account. Public auth fails closed until its unique-email/TTL indexes exist. `npm run admin:create` is an explicit separate local operation; see [authentication](../contracts/authentication.md).

The project uses the standard Nest Mongoose connection injection token with a custom connection factory to sanitize initial failures before retry logging. Future feature modules can use `MongooseModule.forFeature` and explicit schemas/collections. See [Nest MongoDB integration](https://docs.nestjs.com/techniques/mongodb) and [Mongoose connection options](https://mongoosejs.com/docs/connections.html).

## Disposable integration databases

Write-based integration suites use `NODE_ENV=test`, `MONGODB_TEST_URI`, and an exact `MONGODB_TEST_DATABASE` matching `sbt_<32 lowercase hex digits>`. Missing/unsafe settings or a mismatched URI are rejected; application credentials are never used as a fallback. Unit/HTTP suites use synthetic connections and do not require a real database.

Generate a unique test name per run and provision appropriately scoped test credentials. Before cleanup, check both the exact generated name and the connected database name immediately before dropping that test database. Refuse production execution. Close all test connections/apps. Integration/Postman commands now generate a fresh exact test name, verify an empty database before writes, and guard both the connection and configured name before removing only their own disposable database. They close their own app/connection. The application database is never used as a fixture; no broad/prefix-only drop command exists.

## Auth increment verification

The user supplied `MONGODB_TEST_URI` and authorized removing its database path. Only that setting was edited in ignored `.env`; `MONGO_DEV` and other settings were preserved. `test:integration` and `postman:test` load only the dedicated test URI and generate their own `sbt_<32 hex digits>` name. This 36-byte name replaces the original 46-byte test prefix after the supplied cluster rejected database names longer than 38 bytes. Cleanup still requires an exact generated name and matching connection; it is not a prefix-only check.

Real transaction/CRUD/index behavior is now exercised exclusively in disposable auth integration fixtures. [Postman verification](Postman_Auth_Verification.md) records an additional real collection run and cleanup. These do not change the earlier read-only policy finding in the application database or prove deployment-wide lecture non-retention.

Application setup was also executed explicitly on 2026-10-25: `db:prepare` prepared the four allowed platform collections/indexes without creating any account or dropping data. The final read-only policy probe counted 5 total collections (4 allowed, 1 preserved unexpected empty collection), so its policy exit remains 1. A real administrator still requires the user's explicit local bootstrap input.

## 2026-11-02 — Administrator policy preparation

`db:prepare` successfully prepared the five allowed collections/indexes and the `admin-policy-v1` setting used to serialize administrator mutations/bootstrap. No account was inserted, existing record overwritten or data/index dropped. The final read-only diagnostic reported database up, transaction support, 6 total collections, 1 unexpected collection and 0 unexpected nonempty collections. Exit 1 remains the preserved empty policy finding. The old 2026-10-25 counts above remain historical evidence.

Real disposable tests now additionally prove account listing, role/status mutation, audit rollback, full target-session revocation, reactivation without credential restoration and concurrent last-admin/actor protection. See [account contract](../contracts/platform-accounts.md) and [progress](Development_progress.md). The application database was not used as a test fixture; no real administrator was created.

## 2026-11-02 — Enrollment schema handoff

Explicit `db:prepare` now also creates `devices`/`pairingRequests`, their owner/status, unique hashed-code and expiry indexes, and the auth-session device lookup index. Startup/request code does not prepare them automatically. Enrollment operations fail closed when their required indexes are absent. Current health readiness still reports database/topology/auth-index readiness only. See the [enrollment contract](../contracts/device-enrollment.md) for exact operations and limits.

This enrollment increment verified setup, CRUD, transactions, rollback and races only in generated, initially empty, guarded disposable test databases. **Application `db:prepare` and `db:check` were not rerun during this increment.** The previously recorded application collection counts and empty unexpected collection remain the latest application evidence; no new application collection/account or real device was created. An operator must run explicit setup before using enrollment against that application database.

## 2026-11-02 — Recovery index handoff

`db:prepare` now additionally creates `unique_password_recovery_hash`, a unique sparse index on hidden `users.passwordRecoveryHash`. Hidden expiry/auth-version fields accompany that one optional tuple; successful reset removes it. No collection, account TTL index or automatic schema synchronization was added. Expired proofs are rejected directly rather than deleting accounts; unused expired metadata is bounded to one tuple per user. Core authentication/readiness remains independent of recovery preparation; recovery fails closed with 503 until its index is present.

Real disposable tests prove setup, missing-index rejection, idempotent preparation preserving a pending proof, CLI delivery, atomic reset/audit/revocation and races. Application `db:prepare`/`db:check` were not run; no real proof was issued, password reset, administrator created or application record changed. Run explicit setup before enabling the new endpoint there. Prior application collection/policy findings remain the latest evidence. See [recovery contract](../contracts/password-recovery.md).

## 2026-11-02 — Application enrollment/recovery preparation

Under the user's explicit instruction to proceed, the metadata-only pre-check reached `SmartBoardAI` and reported database up, transaction support, 6 total collections, 1 unexpected collection and 0 unexpected nonempty collections. Exit 1 reflected the known preserved empty policy finding.

`npm run db:prepare` then completed successfully (exit 0). It prepared the seven allowed platform collections and declared indexes, including `devices`, `pairingRequests`, the auth-session device lookup and the unique sparse recovery hash index. Its built-in auth/recovery/enrollment index checks passed. The administrator policy setup preserves an existing revision. No account was created, password/proof issued/reset, index dropped, unexpected collection removed or development server started. Existing application records and ignored environment settings were preserved.

The final metadata-only `npm run db:check` reported database up, transactions supported, 8 total collections, 1 unexpected collection and 0 unexpected nonempty collections. It correctly exited 1 for the same pre-existing empty policy finding; that finding remains unresolved. Both commands closed their owned connections. This proves explicit setup/connectivity/topology and metadata checks, not real browser/native/phone behavior or deployment-wide no-retention. Prior not-run statements above remain historical records for their earlier increments.
