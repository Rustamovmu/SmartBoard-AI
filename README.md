# SmartBord-AI backend

NestJS/TypeScript backend for device-owned whiteboard recordings. Private lecture content stays on the recording device. This server is for platform accounts, enrollment, published content and optional transient analysis.

Development follows [the backend plan](docs/Backend_plan.md), [frontend/mobile plan](docs/Frontend_plan.md), and [AGENTS.md](AGENTS.md). Plans specify the target; [development progress](docs/Development_progress.md) records actual implementation and validation.

## Current behavior

- Root-level `src/` project; Node.js 24, npm and the committed lockfile.
- `GET /` still returns `Hello World!` for starter compatibility.
- `GET /health/live` reports process liveness.
- `GET /health/ready` deliberately returns 503 until platform dependencies are implemented.
- Validated `PORT`, `HOST` and `NODE_ENV`; default address `127.0.0.1:3000`.
- Safe HTTP error responses with no request bodies, URLs, exception messages or stacks in the response. Unexpected failures log only a fixed message and status code.
- [Versioned contracts](src/contracts/platform-v1.ts), [storage policy](contracts/storage-policy.md), [analysis lifecycle](contracts/live-protocol.md), and [errors](contracts/errors.md).

MongoDB, accounts/authentication, enrollment, GraphQL, WebSockets and Python vision are not implemented. No frontend/native target exists here. Contract constants describe required future behavior, including analysis limits; they do not activate those services. No GraphQL schema is published until real resolvers exist.

## Setup and operation

```bash
npm ci
npm run build
npm run start:prod
```

These commands start a foreground server; use Ctrl-C to stop it. The application enables shutdown hooks. Only start it when needed. No development host is left running by implementation tests.

The process reads environment variables. It does **not** automatically load `.env`. See [.env.example](.env.example); preserve any existing ignored `.env` and add settings selectively. To explicitly load that file after building:

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

Tests currently cover starter behavior, configuration, contract agreement between the plans, health responses, safe errors and representative forbidden private-content endpoints. They do not prove future database/authentication, native storage, real camera/model behavior, or deployment-wide RAM-only handling.

## Database and next milestone

B2 will use the user's new dedicated `SmartBoardAI` platform MongoDB database, configured in the ignored `.env` through `MONGO_DEV`. Replica-set support must be confirmed before transactions; tests will use separate disposable databases. No other project's records will be used as fixtures. The B1 application does not yet consume the database setting. Never paste or commit database credentials.

Do not add lecture/media/upload modules or adapt the reference projects' upload middleware. Logout/account blocking must never erase device files. See [the storage policy](contracts/storage-policy.md) before adding persistence or telemetry.
