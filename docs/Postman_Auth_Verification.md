# Postman authentication verification — 2026-10-25

The user explicitly requested Postman. The original run used 25 ordered requests; the current [saved collection](../postman/SmartBoardAI.postman_collection.json) contains 83 ordered requests and documented response shapes without credentials. [Sanitized execution evidence](../postman/verification-2026-10-25.json) records the actual official Postman CLI 1.76.0 result: **25 requests, 86 assertions, zero failures, exit 0**. This is a real HTTP run against the Nest app with real isolated MongoDB, separate from the Jest results.

Covered: health and unique disposable-host confirmation; native signup/current account; rejecting ADMIN/private fields; wrong password; credential rotation; old access rejection; refresh replay/family revocation; fresh login/logout; browser CSRF challenge/rejection; secure cookie login/current account/refresh/logout; native Origin rejection; forbidden media API. Cookie assertions verify Secure/HttpOnly/Strict/no Domain attributes. Actual browser HTTPS delivery and native credential storage remain unverified.

## Repeatable CLI run

Prerequisites: Node.js 24, `npm ci`, and dedicated `MONGODB_TEST_URI` in ignored `.env` or process environment, with the database name omitted. It must allow the generated test database's create/index/read/write/transaction/drop operations. Do not use a production/development database as a fixture. Only the test URI is loaded; no fallback to `MONGO_DEV`/`MONGODB_URI`.

```bash
npm run postman:test
```

This starts an app on an OS-assigned loopback port and a fresh `sbt_<32 hex digits>` database. It refuses a nonempty database before setup. The collection requires the host's random `testRunId` marker before any auth write. The official CLI uses the local collection path, `--no-report-events`, no Postman login/API key, and runtime `pm.variables` for synthetic credentials. The wrapper does not pass MongoDB/bootstrap credentials to the CLI. A CLI warning about login/cloud publishing is expected; the actual local run succeeds without either.

See the official [Postman CLI collection-run reference](https://learning.postman.com/docs/postman-cli/postman-cli-collections/) for local-file runs and reporting options.

The wrapper closes the listener and removes only the exact guarded database in `finally`, then closes the connection. No raw response report/cookie jar is exported. The committed evidence contains only counts/scope, not users, tokens, cookies or connection strings. Database name length is 36 bytes; the provided test cluster rejected the earlier 46-byte prefix design with a 38-byte limit. Exact random-name matching is retained before cleanup.

## Desktop import and optional run

Import `postman/SmartBoardAI.postman_collection.json` into Postman. It is named `SmartBoardAI — Auth, administrator accounts and enrollment v1`, keeping unrelated collections untouched. This task opened the desktop import dialog and selected the artifact, but macOS ScreenCaptureKit repeatedly failed afterward. **Successful desktop import and desktop execution were not verified.** No cloud collection link/run publication is claimed. The official CLI run above is verified.

For a desktop run:

```bash
npm run postman:serve
```

Copy the printed `baseUrl` and `testRunId` into the collection variables and run all 83 requests once in order. Keep fixture credentials/tokens in runtime variables; do not persist resolved values, enable raw response persistence, publish results, or use real accounts. The defaults refuse to run against an unconfirmed service. Browser scenarios manually supply cookie headers over loopback for wire checks, without weakening the Secure cookies used by the app.

Stop the foreground host with Ctrl-C afterward; it also has a 15-minute timeout. Multiple shutdown signals share one guarded cleanup operation. The first manual npm/PTY interruption in this task stopped its listener before the normal cleanup message; the exact recorded disposable database was then checked and removed explicitly. The repeatable wrapper was added and successfully verified automatic cleanup. The user's `SmartBoardAI` database and its empty pre-existing collection were not used for test writes or cleanup.

## Other evidence and limitations

Real MongoDB Jest integration additionally covers transactional signup rollback, concurrent duplicate email/signup, concurrent refresh, forged family proof, expiry independent of TTL, absolute-session clamping, current roles/status, isolated logout, rate limits, malformed/oversized bodies, unknown/operator inputs, CLI admin bootstrap/audit and forbidden collection names. See [development progress](Development_progress.md) for final suite counts and exact changed files.

The 2026-10-25 results above did not validate last-admin mutation protection or GraphQL; those now have the additional dated evidence below. Device enrollment now has additional dated API evidence below. WebSockets, real browsers/phones, vision, physical camera behavior and deployment retention remain unverified. Postman is a platform API verification tool; no private lecture/media fixture is sent to it.

## 2026-11-02 — GraphQL administrator verification

The expanded collection passed with official Postman CLI 1.76.0: **41 requests, 150 assertions, zero failures, exit 0**. [Sanitized evidence](../postman/verification-2026-11-02.json) contains counts/scope only. It adds native GraphQL current account, USER rejection, administrator pagination, block/reactivation with old-session rejection, last-active-admin rejection, promotion/demotion with fresh login, and private-field/introspection rejection. The prior authentication flows also passed.

After proving its generated database is empty, the test host prepares the administrator policy and creates/audits one synthetic administrator in that disposable database only. Collection runtime variables derive fixture credentials from the random host marker; these are test-only, deliberately public to local test clients, and never production credentials. There is no HTTP bootstrap route. MongoDB and real bootstrap credentials are stripped from the CLI environment. The wrapper confirmed its exact database removal and host shutdown; the final loopback port had no remaining listener.

Additional Jest integration verifies simultaneous self-demotions and cross-blocks, audit-failure rollback, null/operator/UUID/bounds rejection, real browser-wire CSRF/origin checks and missing-policy failure. Desktop import/run remains unverified because of the earlier macOS capture failure. The saved collection is reviewable; no cloud publication or desktop success is claimed.

## 2026-11-02 — Device enrollment verification

Official Postman CLI 1.76.0 passed **57 requests and 215 assertions, zero failures, exit 0**. [Sanitized evidence](../postman/verification-2026-11-02-enrollment.json) records counts/scope only. Sixteen new requests cover native pairing, independent same-account approval, rejection of self/foreign-admin approval and code replay, session binding, owner/admin pagination, USER rejection on administrator device reads, private-field rejection, revocation of access/refresh and survival of an unrelated session. Enrollment uses its own synthetic account, keeping the original fixture's login-rate budget separate.

The original 41 request definitions are preserved except request 35's expected fixed `CONFLICT` message, intentionally generalized from account-specific wording to `Change conflicts with platform policy.` for the shared account/device error adapter. Codes and HTTP statuses are unchanged. Earlier expanded runs stopped at that stale assertion; all their hosts/databases were cleaned up. The runner now reports only the last known static request name on CLI failure, never raw failure output that could contain credentials or response bodies.

The final wrapper confirmed exact disposable database removal and host closure. No cloud event reporting, live response example, raw report/cookie jar, application DB change or desktop run was introduced. Jest additionally passed real expiry-independent-of-TTL, supersession, concurrent approval/cap, ownership, current device state, refresh/revocation and account-block races, audit rollback, rate-limit and browser-wire CSRF/origin cases. Native storage, trusted browser HTTPS, physical phones and active WebSocket revocation remain outside this API verification.

## 2026-11-02 — Selected-device batch verification

Official Postman CLI 1.76.0 passed **70 requests and 269 assertions, zero failures, exit 0**. The prior 57 requests are unchanged. Thirteen appended requests verify a second native enrollment, whole-selection rejection when an ID is missing, preservation of the active target after rejection, duplicate-ID validation, USER rejection on the administrator batch, successful owner revocation with input order/counts, access/refresh rejection afterward, administrator no-op repetition with unchanged timestamps, administrator missing-ID rejection and continued rejection of GraphQL HTTP request arrays. See [batch contract](../contracts/device-batches.md) and [sanitized evidence](../postman/verification-2026-11-02-device-batches.json).

The CLI used its exact generated and initially empty `sbt_<32 hex digits>` database through the dedicated test URI, synthetic identities and runtime-only credentials. The wrapper confirmed exact database removal and host closure; the final loopback port had no remaining listener. No cloud event reporting, live response examples, raw report/cookie jar, application DB operation or desktop/phone run was introduced.

## 2026-11-02 — Password recovery verification

Official Postman CLI 1.76.0 passed **83 requests and 322 assertions, zero failures, exit 0**. All prior 70 requests remain unchanged. Thirteen appended requests cover a synthetic recovery fixture, old-password login, malformed/private-field rejection, browser CSRF rejection, successful reset without automatic login, old access/refresh rejection, proof replay, old-password rejection, new-password login with unchanged role/status, safe current account and absence of a public auth issuer. See [recovery contract](../contracts/password-recovery.md) and [sanitized evidence](../postman/verification-2026-11-02-password-recovery.json).

To deliver a randomly generated proof without saved credentials, the disposable host script registers one test-only `GET /__test/recovery-proof`. It requires the verified test marker, verifies exact owned database identity, accepts no account selection and creates only its fixed synthetic account at the later collection step, preserving earlier account counts. It permits one retrieval, uses `no-store`, and is absent from AppModule/production controllers. A focused real integration check verifies that absence. Proofs exist only in runtime variables; they are not in command arguments, saved responses/examples, raw reports or evidence.

The wrapper confirmed exact test database removal and host closure; the final loopback port had no listener. No cloud event reporting, application operation, real user or desktop/phone run was introduced. The actual pipe-only npm recovery CLI was separately verified by Jest against disposable accounts, including last-admin recovery and rejection of ordinary/regular-file output; clipboard/human delivery remains unverified.
