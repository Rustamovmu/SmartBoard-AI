# Postman authentication verification — 2026-10-25

The user explicitly requested Postman. The [saved collection](../postman/SmartBoardAI.postman_collection.json) contains 25 ordered requests and documented response shapes without credentials. [Sanitized execution evidence](../postman/verification-2026-10-25.json) records the actual official Postman CLI 1.76.0 result: **25 requests, 86 assertions, zero failures, exit 0**. This is a real HTTP run against the Nest app with real isolated MongoDB, separate from the Jest results.

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

Import `postman/SmartBoardAI.postman_collection.json` into Postman. It is named `SmartBoardAI — Auth v1`, keeping unrelated collections untouched. This task opened the desktop import dialog and selected the artifact, but macOS ScreenCaptureKit repeatedly failed afterward. **Successful desktop import and desktop execution were not verified.** No cloud collection link/run publication is claimed. The official CLI run above is verified.

For a desktop run:

```bash
npm run postman:serve
```

Copy the printed `baseUrl` and `testRunId` into the collection variables and run all 25 requests once in order. Keep fixture credentials/tokens in runtime variables; do not persist resolved values, enable raw response persistence, publish results, or use real accounts. The defaults refuse to run against an unconfirmed service. Browser scenarios manually supply cookie headers over loopback for wire checks, without weakening the Secure cookies used by the app.

Stop the foreground host with Ctrl-C afterward; it also has a 15-minute timeout. Multiple shutdown signals share one guarded cleanup operation. The first manual npm/PTY interruption in this task stopped its listener before the normal cleanup message; the exact recorded disposable database was then checked and removed explicitly. The repeatable wrapper was added and successfully verified automatic cleanup. The user's `SmartBoardAI` database and its empty pre-existing collection were not used for test writes or cleanup.

## Other evidence and limitations

Real MongoDB Jest integration additionally covers transactional signup rollback, concurrent duplicate email/signup, concurrent refresh, forged family proof, expiry independent of TTL, absolute-session clamping, current roles/status, isolated logout, rate limits, malformed/oversized bodies, unknown/operator inputs, CLI admin bootstrap/audit and forbidden collection names. See [development progress](Development_progress.md) for final suite counts and exact changed files.

These results do not validate device enrollment, last-admin mutation protection, GraphQL, WebSockets, real browsers/phones, vision, physical camera behavior or deployment retention. Postman is a platform API verification tool; no private lecture/media fixture is sent to it.
