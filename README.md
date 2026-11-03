# SmartBord-AI backend

NestJS/TypeScript platform backend for device-owned whiteboard recordings. Private lectures, media, notes, OCR and durable capture records belong on the recording device. The backend stores accounts, authentication and explicitly published platform content only.

Follow [AGENTS.md](AGENTS.md), [backend plan](docs/Backend_plan.md) and [frontend/mobile plan](docs/Frontend_plan.md). [Development progress](docs/Development_progress.md) distinguishes implementation and verification from planned work.

## Implemented

- Root-level `src/`, Node.js 24, npm and committed lockfile; default `127.0.0.1:3000`.
- `GET /` starter compatibility; live/readiness health routes with database/topology/auth-index checks.
- HTTP signup/login/refresh/logout/me/CSRF with strict DTOs and an 8 KiB JSON body limit.
- Argon2id passwords; hashed opaque access/refresh credentials; 15-minute access and rotating sessions capped at 30 days.
- Separate browser Secure/HttpOnly/SameSite cookies and native credential transport, with origin/CSRF checks and MongoDB rate limits.
- Current account/session/status checks and an administrator guard. Public signup creates USER only.
- Explicit local schema setup and administrator bootstrap with a transactional audit record.
- Operator-assisted [password recovery](contracts/password-recovery.md): pipe-only local issuance, expiring single-use proofs, audited password reset and all-session revocation without changing role/status.
- Authenticated GraphQL current account and admin account pagination/access changes, transactional audit/session revocation and concurrent last-admin protection. See [account operations](contracts/platform-accounts.md) and [schema](contracts/schema.graphql).
- Native-session device pairing with same-account approval, owner/admin device lists and audited revocation of bound sessions, including [atomic batches of up to 20 selected devices](contracts/device-batches.md). See [enrollment](contracts/device-enrollment.md). Physical phone identity/storage and connected streams are not implemented by this API.
- Real MongoDB integration tests using guarded disposable databases, plus a repeatable [Postman collection and verification](docs/Postman_Auth_Verification.md).

Published-content operations, WebSockets and Python vision remain planned here. The separate [frontend/mobile repository](../SmartBord-AI-frontend/README.md) now implements a photo-storage foundation with automated checks and an Android debug build; [physical Android/iPhone acceptance remains pending](../SmartBord-AI-frontend/docs/Verification.md). No lecture upload/library/archive or phone-wipe API exists. No fully offline AI or physical phone storage proof is claimed.

## Setup and operation

```bash
npm ci
npm run db:prepare
npm run build
npm run start:prod
```

Configure the dedicated `SmartBoardAI` database first in ignored `.env`: `MONGODB_URI`, or the existing `MONGO_DEV` key in development. Production requires `MONGODB_URI` and explicit `AUTH_BROWSER_ORIGINS`. See [.env.example](.env.example), [database setup](docs/Database_setup.md) and [authentication contract](contracts/authentication.md). Preserve actual credentials outside Git/chat.

The npm start variants and operational database/admin commands load `.env` if present; existing process environment wins. `db:prepare` explicitly creates allowed platform collections/indexes and the singleton administrator policy, preserving existing records/indexes. Auth fails closed until its unique-email and TTL indexes exist. No command bootstraps an administrator automatically. `admin:create` requires explicit operator details; see the authentication contract for secure input.

`PORT` must be 1–65535, `HOST` an IP address or `localhost`, and `NODE_ENV` development/test/production. The source fallback remains `127.0.0.1:3000` when PORT is unset. For the separate website's normal development flow, save these non-secret settings in the existing ignored backend `.env`, preserving its credentials:

```dotenv
PORT=4001
AUTH_BROWSER_ORIGINS=https://localhost:3000
```

Then `npm run start:dev` uses backend HTTP 4001 on every restart. The website's `yarn dev` owns trusted HTTPS 3000 and its API TLS bridge owns 4000. Stop any old backend watcher still using 3000 before restarting; repeatedly launching the website cannot free another process's socket. This checkout's local settings were configured accordingly on 2026-11-02. Backend defaults, database URIs and application records are unchanged.

Foreground hosts stop with Ctrl-C and close their own connections. Do not leave development servers running unnecessarily. Website authentication needs trusted HTTPS and same-site web/API deployment; cookie security is never disabled for HTTP development. Native loopback HTTP is used only for local verification.

## Validation

```bash
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:integration
npm run postman:test
npm run build
npm run schema:generate
```

There is no npm `typecheck` script. Lint is non-fixing; build writes ignored output. `format` rewrites files. Unit/root E2E suites use synthetic connections and do not load `.env`. Integration/Postman commands load only the dedicated `MONGODB_TEST_URI`, generate a unique `sbt_<32 hex digits>` database, check that it starts empty, and verify its exact identity before cleanup. They never fall back to application credentials. The shorter prefix accommodates the provided cluster's 38-byte name limit.

`postman:test` uses the official pinned Postman CLI, confirms a unique test-host marker before auth requests, disables cloud event reporting and closes/removes its own host/database in `finally`. No Postman login/API key is needed for the local file run. `postman:serve` supports optional desktop runs and stops automatically after 15 minutes. See [Postman verification](docs/Postman_Auth_Verification.md).

Backend checks cover implemented identity, GraphQL account and device-enrollment behavior. The separate [Pages Router website](../smartbord-ai-frontend-web/README.md) adds signup/login/account, protected `/admin/users` account management and [trusted-HTTPS browser verification](../smartbord-ai-frontend-web/docs/Verification.md). The test-only `scripts/browser-auth-host.ts` uses guarded disposable MongoDB and private fixture IPC; explicit browser-admin mode seeds synthetic administrators through existing services only after empty-database preparation. AppModule has no fixture route and application administrators are never created by those tests. F3 help/FAQ and community remain planned. B3/F1 physical-phone storage proof, native secure-storage bridges, phone recording, vision and deployment-wide no-retention remain unverified. Known dependency advisories and outstanding acceptance are in the progress record.

## Read-only database inspection

```bash
npm run db:check
```

This command probes connectivity/topology and collection metadata/counts, prints non-content state, and closes its connection. It changes no records or collections. Exit 1 also reports policy findings; the pre-existing empty unexpected collection was preserved. [Database setup](docs/Database_setup.md) records actual evidence and limits.

Private lecture content must never enter MongoDB, filesystem storage, queues, logs, telemetry or backups. [Storage policy](contracts/storage-policy.md), [analysis lifecycle](contracts/live-protocol.md) and [errors](contracts/errors.md) govern future work. Logout/account blocking revokes platform access without any phone-file deletion command.
