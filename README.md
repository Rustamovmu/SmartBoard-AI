# SmartBord-AI backend

NestJS/TypeScript backend for device-owned whiteboard recordings. Private lecture content stays on the recording device. This server is for platform accounts, enrollment, published content and optional transient analysis.

Development follows [the backend plan](docs/Backend_plan.md), [frontend/mobile plan](docs/Frontend_plan.md), and [AGENTS.md](AGENTS.md). Plans specify the target; [development progress](docs/Development_progress.md) records actual implementation and validation.

## Current behavior

- Root-level `src/` project; Node.js 24, npm and the committed lockfile.
- `GET /` still returns `Hello World!` for starter compatibility.
- `GET /health/live` reports process liveness.
- `GET /health/ready` returns 200 only when bounded database probes succeed and transaction topology is supported; otherwise 503.
- Validated `PORT`, `HOST` and `NODE_ENV`; default address `127.0.0.1:3000`.
- Safe HTTP error responses with no request bodies, URLs, exception messages or stacks in the response. Unexpected failures log only a fixed message and status code.
- [Versioned contracts](src/contracts/platform-v1.ts), [storage policy](contracts/storage-policy.md), [analysis lifecycle](contracts/live-protocol.md), and [errors](contracts/errors.md).

Mongoose connection management and read-only database diagnostics are implemented. Accounts/authentication, enrollment, GraphQL, WebSockets and Python vision are not implemented. No frontend/native target exists here. Contract constants describe required future behavior, including analysis limits; they do not activate those services. No GraphQL schema is published until real resolvers exist. Database readiness does not mean these future features are complete.

## Setup and operation

```bash
npm ci
npm run build
npm run start:prod
```

Provide database configuration first. These commands start a foreground server; use Ctrl-C to stop it. Shutdown hooks close the app-owned database connection. Only start the host when needed. No development host is left running by implementation tests.

The npm start variants and database diagnostic load `.env` if present; existing process environment variables take precedence. See [.env.example](.env.example); preserve existing settings. To load that file explicitly after building:

```bash
node --env-file=.env dist/main.js
```

`PORT` must be 1–65535, `HOST` an IP address or `localhost`, and `NODE_ENV` development/test/production. Binding to a non-loopback address requires an explicit `HOST`. The plan's port 4000 can be selected with `PORT=4000`; the code default remains 3000.

Node's environment-file behavior is documented in the [Node.js CLI reference](https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-filefile). Health checks follow the liveness/readiness distinction in [NestJS health documentation](https://docs.nestjs.com/recipes/terminus).

## Validation

```bash
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

There is no npm `typecheck` script. `lint` is non-fixing. Build creates ignored `dist/` output. `format` rewrites source and is not an inspection command. E2E apps bind temporary loopback ports and close their own servers.

Tests currently cover starter behavior, configuration, contract agreement between the plans, health responses, safe errors, representative forbidden private-content endpoints and database lifecycle/configuration safety. HTTP tests override the connection with explicit synthetic stubs; they never load `.env` or contact the application database. They do not prove database CRUD permissions, real transactions, future authentication, native storage, real camera/model behavior, or deployment-wide RAM-only handling.

## Database

The dedicated database is `SmartBoardAI`. Set `MONGODB_URI` in ignored local configuration; development also accepts the existing `MONGO_DEV` key. Production requires `MONGODB_URI`. If both development keys exist, `MONGODB_URI` takes precedence. A URI selecting a different database is rejected. Connections have bounded timeouts and pools, no command monitoring, no Mongoose debug/body logging, no command buffering and no automatic collection/index creation. Connection failures produce a fixed safe error. Future platform schemas/indexes will be introduced explicitly with their features.

```bash
npm run db:check
```

This read-only diagnostic uses ping, topology and collection metadata/count commands, prints only non-content state, and closes its connection. It never creates/drops collections, inserts records, or reads document contents. Exit 0 requires reachable database, transaction-capable topology and only planned collection names. Exit 1 is also used for policy findings, not just network errors. It does not prove CRUD/transaction permissions or deployment-wide non-retention. See [database setup and validation](docs/Database_setup.md) and [health API examples](docs/Health_API.md).

Database integration runs require `NODE_ENV=test`, `MONGODB_TEST_URI`, and an exact `MONGODB_TEST_DATABASE` matching `smartbord_test_<32 lowercase hex digits>`. They never fall back to application credentials. No write-based integration suite exists yet; its eventual cleanup must recheck the exact generated database name before dropping anything.

## Next milestone

B2 identity work remains: accounts, Argon2id, session rotation/revocation, current-account guards, enrollment, browser/native credential transports and explicit admin bootstrap. Existing dependency audit findings are tracked in the progress record; this foundation is not production acceptance.

Do not add lecture/media/upload modules or adapt the reference projects' upload middleware. Logout/account blocking must never erase device files. See [the storage policy](contracts/storage-policy.md) before adding persistence or telemetry.
