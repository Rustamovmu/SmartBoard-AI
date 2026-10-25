# AGENTS.md — SmartBord-AI backend

## Read first and distinguish implementation from plans

Before changes, read the relevant source and these documents:

- [Backend plan](docs/Backend_plan.md).
- [Frontend and mobile plan](docs/Frontend_plan.md).
- [README](README.md), [package scripts](package.json), [development progress](docs/Development_progress.md), and the relevant source, configuration and tests. Use dated verification records for implemented scope, not target plans as acceptance evidence.

The plans describe the agreed V2 target. This repository is being developed incrementally from a root-level NestJS starter, not the legacy FastAPI/Vite application described in the plans. Historical MVP descriptions and results do not establish what is implemented here. Use the actual plan paths above; their companion links were corrected during B1.

The user's latest explicit requirements take precedence over older plans. In particular, earlier server-primary storage decisions and the MVP's no-database/no-authentication rules have been superseded for V2. Use source code to establish current behavior and the latest plans to establish intended behavior. Report discrepancies rather than claiming planned features already work.

## Current repository and implementation

- Working backend project: `/Users/a1234/Developer/SmartBord-AI`, package name `smartbord-ai`. Source lives directly under `src/`; there is no implemented `apps/api/` layout here.
- Entry point: `src/main.ts` creates `AppModule` from `src/app.module.ts`, enables shutdown hooks and listens on validated `PORT`/`HOST`, defaulting to `127.0.0.1:3000`. The plan's NestJS port 4000 is an optional development convention, not the current default. Do not change ports as part of documentation work.
- `src/app.controller.ts` delegates `GET /` to `src/app.service.ts`, which returns `Hello World!`. The root module imports configuration, database, health, auth and audit modules and registers strict validation and a safe HTTP error filter. `src/app.setup.ts` configures bounded JSON parsing and exact-origin CORS for the actual host/integration/Postman apps.
- `src/app.controller.spec.ts` preserves the starter unit test; `test/app.e2e-spec.ts` covers root/health and forbidden routes. Unit, HTTP and real MongoDB auth suites are configured in `jest.config.ts`, `test/jest-e2e.json` and `test/jest-integration.json`.
- B1 implements configuration validation, health routes, safe HTTP errors and versioned policy/contracts. See `src/contracts/` and `contracts/`; declared future routes/limits do not activate services. No GraphQL schema exists yet.
- B2 adds Mongoose connection management, read-only `npm run db:check`, auth/member/audit schemas, explicit `db:prepare` and `admin:create` commands, and `/auth/*` HTTP identity operations. Start scripts load ignored `.env`; development accepts `MONGO_DEV`, production requires `MONGODB_URI`. The application database is `SmartBoardAI`. Connection options still disable automatic collections/indexes; setup is explicit. See [authentication](contracts/authentication.md) for opaque tokens, strict rotation/replay behavior, cookies/CSRF, native transport and limits.
- `GET /health/live` returns 200 after startup; `/health/ready` requires reachable/transaction-capable MongoDB and required auth indexes, otherwise 503. Root E2E apps use synthetic connections. `test:integration` and `postman:test` use only a dedicated `MONGODB_TEST_URI`, generate exact `sbt_<32 hex digits>` databases, verify initial emptiness and guard identity before cleanup. Real test CRUD/transactions are verified in those disposable fixtures, never in application records.
- Public signup creates USER only. Admin bootstrap is an explicit local CLI with a transactional audit event. Current-account/session/status checks and an admin guard exist. Enrollment, administrator role/status mutations and last-admin protection, GraphQL/Apollo, analysis/control WebSockets, Python vision and user/admin platform modules remain planned. No actual administrator was bootstrapped in the application database by this increment.
- Next.js, React/Vite/Capacitor, native recording, SQLite and device-file adapters belong to the separate planned frontend project. No frontend/mobile target or Python vision service currently exists in this repository.
- The following implementation rules describe required future behavior. A rule, dependency, schema, starter test or plan is not evidence that a feature works. Reinspect source before updating this baseline.

## Reference projects

This file adapts the analyze-first, incremental-change and validation workflow from [TripLink frontend AGENTS.md](../tripLInk-next/AGENTS.md) and its referenced [TripLink backend AGENTS.md](../trip-link/AGENTS.md).

- Frontend structural references: `../tripLInk-next` and `../nestar-next`.
- Backend structural references: `../trip-link` and `../nestar`.
- Before adapting a comparable feature, inspect its relevant layout/component/Apollo operation or module/resolver/service/DTO/schema/guard in those references.
- If a reference has no equivalent for phone-local storage, recording, board tracking or transient AI, say so and use this project's plans and platform documentation.
- Reference projects are read-only unless the user separately requests changes there. Do not copy their secrets, user data, Git history, uploads or unrelated business features.
- Their approval and commit policies apply to those repositories, not this one. Follow this project's authorization and required-local-commit rules; do not import extra approval gates from a reference.
- Do not import TripLink ports, tour/property fields, AGENT role, pagination shapes, package-manager rules or historical acceptance claims as this project's requirements.
- If a reference path is unavailable, use available local documentation and explain the limitation. Do not invent a reference implementation or silently modify a sibling repository.

## Change workflow and authorization

1. Inspect before editing. Identify the current entry points, ownership boundaries, contracts, storage behavior and relevant tests.
2. Explain the target files, intended behavior and validation before making changes. Call out API, schema, privacy, authentication and UI impacts where relevant.
3. Work within the user's authorized scope. An explicit request to implement a defined task authorizes its necessary edits and validation; do not ask for the same approval repeatedly. A planning/documentation request alone does not authorize application implementation, deployment or destructive migration.
4. Make cohesive incremental changes. Preserve working logic until a safe replacement exists. Do not rewrite, rename or copy the entire application merely to imitate a reference tree.
5. Inspect the worktree and preserve existing user changes. Never reset Git, delete user data or drop development databases without explicit authorization. Focused local commits are already authorized and required under “Required Git commits” below.
6. Run checks appropriate to the change and report actual results. Document unimplemented behavior and limitations. Do not report skipped or unexecuted checks as passed.
7. Update the relevant documentation and existing completion/verification records after meaningful changes; distinguish historical MVP results from new V2 evidence.

The user requested the development host be stopped. Keep servers stopped during planning, documentation and read-only tasks. For implementation verification, start only necessary temporary services within the authorized task, report what was started and stop your own temporary services afterward. Do not stop unrelated user processes or expose services publicly by default.

## Non-negotiable device-only lecture storage

All private lecture content belongs on the recording user's personal device:

- Video/audio, original/enhanced images, thumbnails, PDFs and exported bundles.
- Lecture titles, notes, OCR text, capture history, calibration and comparison baselines.
- Durable recording/recovery manifests and local file references.

V2 must not persist this content in our server filesystem, MongoDB, object storage, logs, caches, backups or disk-backed job queues. Do not introduce a server recording archive, lecture-sync service, private media gallery or automatic developer/cloud backup.

MongoDB is for accounts, authentication sessions, enrollment, roles, FAQs, announcements, intentionally published community text, moderation and platform administration. It must not contain private lecture/capture collections, media references, OCR or recording-derived timelines. Publishing community content is an explicit separate action; do not attach private lecture files or transcripts automatically.

SQLite on the phone stores the private local catalog; durable phone files store media bytes. Originals must never exist only in a cache. Preserve originals and write enhanced versions separately. Do not delete existing legacy Mac recordings to enforce a future storage policy: migrate through an explicit local export/import with checksums, preserving originals.

Logging out, token expiry or account blocking must not erase the user's local files. Admin authority covers the platform, not private phone recordings. No admin API or screen may browse, download or remotely wipe phone-only lecture content.

## Repository boundaries and tool choices

The target has two separate repositories/projects, each with multiple source files:

- Backend: this `SmartBord-AI` repository, currently a NestJS/TypeScript starter; a private Python vision service is planned.
- Frontend: a separate project for the planned Next.js website and React/Vite/Capacitor mobile targets, with shared UI, contracts and local-library adapters. Its actual implementation location has not been established by this task.

The plans' `whiteboard-backend/`, `whiteboard-frontend/`, `apps/api/`, `services/vision/` and shared-package trees are target examples, not existing paths. Keep the root-level backend structure until a separate explicit task authorizes restructuring. Do not rename/move repositories, create the frontend project or replace the directory tree without a task establishing the actual target location.

Preserve the current TypeScript configuration: `module` and `moduleResolution` are `nodenext`, and `package.json` has no `type: module`, so the current backend `.ts` files use CommonJS behavior. Tests use Jest/ts-jest; the configured npm test commands include `--experimental-vm-modules`. Do not switch module settings or test runners merely to match another project. Planned frontend targets use ESM; the planned vision service uses typed Python.

Use npm and the committed `package-lock.json` in this workspace; `package.json` currently has no `packageManager` field. TripLink's Yarn-only instruction is reference-specific. Do not switch managers or create competing lockfiles without an explicit task reason. Inspect package scripts before choosing commands; do not invent a passing test/typecheck script or hide its absence.

Use compatible supported dependencies and committed lockfiles. Avoid unnecessary cloud services, Redis, object storage, abstraction layers or dependencies. Default to CPU-compatible vision; never assume CUDA. Download legitimate model weights explicitly, cache them locally and avoid runtime dependency/model downloads.

## Backend implementation rules

- Keep feature modules separated: auth, members, enrollment, analysis access, help center, community, reports, admin, audit and health.
- Put business rules in services, access checks in guards/policies, validated wire shapes in DTOs and persistence definitions in schemas. Resolvers/controllers should remain thin.
- Use GraphQL/Apollo for structured platform operations, HTTP for authentication/access grants and native WebSocket for transient analysis/control. GraphQL is not a media-upload transport.
- Maintain the shared contracts in both V2 plans: `/graphql`, `/auth/*`, `/analysis/access`, `/ws/analyze`, `/ws/control` and `/health/*`.
- Lists use `{ items, page, pageSize, total }`. Do not copy TripLink's unrelated pagination shape. Use opaque wire IDs, ISO UTC timestamps and separate source-video times.
- Validate/whitelist inputs, reject unknown fields, enforce ownership and role/status checks, and return stable useful errors. Never accept arbitrary filesystem paths or unrestricted URL fetches.
- Any MongoDB transactions must run against an appropriate replica set. Tests use isolated disposable databases, never production/development records as fixtures.
- Do not introduce a server filesystem lecture Store or copy one from the legacy MVP. If existing vision algorithms are reused, inspect their actual source and adapt them through a transient service boundary; they are not currently present here.

## Authentication and authorization

- Public signup creates USER only. Bootstrap ADMIN through an explicit local command; no default password or automatic first-signup promotion. Protect the last active admin.
- Hash passwords with Argon2id. Keep secrets, raw credentials and tokens out of logs, Git and frontend bundles.
- Follow the plan's 15-minute access tokens and rotating/revocable refresh sessions with a 30-day maximum lifetime unless the user changes that policy.
- Website credentials use Secure/HttpOnly/same-site cookies with CSRF/origin checks. Native credentials use Keychain/Keystore-backed secure storage, never ordinary SQLite or localStorage.
- Authenticate the current account and enforce its current status/role server-side. A frontend route guard or decoded token alone is insufficient authorization.
- Revoke connected service access when an account/device is blocked. Keep already owned local recordings intact.
- Rate-limit sensitive operations and scope analysis permissions to their intended ephemeral stream. Do not put credentials in URLs.
- Admins manage accounts, enrollment, published content, moderation and platform health. Do not add private media access under the phrase “manage all data.”

## Frontend and native-mobile rules

These are cross-project contract and handoff requirements for the separate planned frontend. They do not authorize creating frontend/native targets in this backend repository.

- Preserve the Nestar/TripLink-style separation of routes, layouts, typed Apollo operations, reusable components and user/admin modules while creating a product-specific interface.
- Generate platform API types from the versioned schema. Do not import Nest decorators or Mongoose documents into browser/native UI code. Keep SSR authentication/cache request-scoped.
- Bundle the mobile app assets locally. Keep Next.js server rendering in the website target and native SQLite/filesystem/media bridges in the mobile target.
- Use persistent Documents/data storage for accepted notes and recordings. Saving to Photos/Gallery/Files uses the relevant native APIs, permissions and confirmed outcomes; browser storage is not a universal substitute for these behaviors.
- Record long video through native bounded file I/O, not an unbounded JavaScript/base64 buffer. Handle interrupted recording, storage-full errors, permission denial and recovery honestly.
- Keep local capture, notes, playback and export usable without the backend. Do not claim fully offline AI until on-device inference is implemented and tested.
- Use one camera/sampling loop per active source, one in-flight analysis frame and bounded queues. Retain one pending explicit capture command rather than silently dropping a user click during inference.
- Clean up camera tracks, timers, sockets, native resources and object URLs on stop/navigation/logout. Test phone backgrounding, rotation and device interruptions rather than promising unsupported background recording.
- Support loading, empty, pending, denied, error and success states on every real screen. Use accessible controls, focus/keyboard behavior, readable contrast and responsive layouts.
- Show “Saved on this phone” only after actual local file/catalog persistence. Distinguish local save, optional gallery export, analysis pending, unavailable AI and save failure.
- Do not show fabricated captures, AI confidence, OCR text, metrics or functional-looking buttons without real behavior. Explicit synthetic fixtures belong in tests/design stories only.

## Vision and transient-analysis guarantees

- The planned Python vision service uses OpenCV as its core image-processing technology. Keep calibration, perspective, quality, motion, content comparison, person detection and decision logic modular.
- Integrate the real pretrained person detector into capture gating. A stationary detected person may still obstruct the board. Missing AI means unknown/degraded visibility, not confidently unobstructed.
- Require fresh person inference for automatic capture candidates when AI is available. Compare against the last accepted state using multiple signals; SSIM alone must not trigger capture.
- Use normalized unmirrored source coordinates for overlays, rectified coordinates for comparisons, and timestamps rather than frame counts for stability.
- Differentiate mounted-camera calibration from handheld board tracking. Suppress automatic capture when tracking/alignment is uncertain; ask for steadiness/recalibration.
- Require valid tracking/calibration, quality, stability, meaningful change and duplicate protection. A cooldown delays pending legitimate changes rather than losing them.
- The phone owns the durable baseline. Advance worker comparison state only after the phone acknowledges a successful local save. Make retries/idempotence work without a server capture archive.
- Optional connected analysis may process selected frames in bounded RAM only after disclosure/permission. Clear buffers on disconnect, expiry and revocation. No disk spooling, image debugging, body logs, persistent OCR jobs or recorded-content telemetry.
- Audit proxy buffering, temporary files, tracing, crash dumps and hosting memory/swap behavior before claiming strict no-retention. Temporary transmission is not zero transmission; zero-transmission AI must run on the device.

## Validation, API examples and reporting

- For non-writing type inspection, use `./node_modules/.bin/tsc --noEmit --incremental false`. There is no configured `typecheck` npm script.
- Current backend checks are `npm run lint` (non-fixing Oxlint), `npm test -- --runInBand` (Jest unit tests), `npm run test:e2e -- --runInBand` (Supertest endpoint tests), and `npm run build` (NestJS compilation). Builds write generated output; the `format` script rewrites files and is not an inspection command. Choose checks appropriate to the implementation change and inspect scripts before running them.
- Auth changes also use `npm run test:integration` (real disposable MongoDB) and `npm run postman:test` (official Postman CLI, generated loopback host/database with cleanup). These load only the dedicated test URI and never fall back to application credentials. Desktop Postman import/run was not verified due a macOS capture failure; CLI verification is recorded in `docs/Postman_Auth_Verification.md`.
- Documentation-only changes need link/path, accuracy, diff and whitespace checks, not application tests or server startup. Include untracked task files in review; `git diff` alone does not show their contents.
- Starter checks cover only existing starter behavior; passing them does not validate MongoDB, authentication, GraphQL, WebSockets, Python vision, phone storage or native recording. There is no Python environment or frontend target here to validate with legacy MVP commands.
- Planned features require Jest/Nest/Supertest and real WebSocket clients, Pytest for vision, frontend component/browser tests and native-device tests as they are implemented. Run frontend/Python checks in their actual established project/service locations, using configured commands; never report planned or skipped suites as passed.
- For API changes, document exact endpoint/GraphQL operation, Variables, required identity/role, disposable prerequisites, expected success/rejection and cleanup. Live Postman requests/saved examples require the user's request; automated results are not Postman examples.
- Integration tests must guard the exact disposable database name before destructive cleanup, avoid production execution and close their own connections/apps. Never alter real records to simulate test cases.
- Test local save/reopen with the backend unavailable, duplicate responses, disk/permission failures, interrupted recording and logout/blocking without file loss.
- Test backend authorization and verify no retained lecture content in MongoDB, filesystem, temp files, logs, caches and backup outputs after successful/failed/interrupted analysis.
- Synthetic camera/obstruction fixtures do not prove physical camera, handheld tracking or real person-detection accuracy. Record real Android/iPhone/classroom cases as unverified until actually exercised.
- Keep test evidence dated and scoped. Report exact changed files, checks run/results, blockers and material limitations. Create the required focused local commit under the standing authorization below and report its hash; do not claim a commit was made if it failed.

## Current completion boundary

The V2 plans and these instructions are specifications. Creating/updating them does not authorize an unrequested application rewrite or establish that native mobile storage, accounts, transient analysis or admin pages are finished.

The first device-storage implementation proof is a real phone capture/recording that remains readable after app restart and backend shutdown, with no private copy retained by our backend. This requires coordinated work with the separate frontend/native project; the current backend starter cannot supply that proof. Build the platform and visual polish around that verified behavior. Plan updates and starter checks are not V2 acceptance evidence.

## Required Git commits

- The user requires a Git commit for every completed change or new feature. This is standing authorization to create the necessary local commits; do not repeatedly ask for commit permission.
- Make one focused commit per cohesive change, feature, fix or documentation update after its relevant validation. Keep associated tests, contracts and documentation with the behavior they explain. Do not accumulate unrelated completed work into a single commit.
- Before staging, inspect `git status`, the diff and the repository/branch. Stage explicit task-related paths or hunks; preserve unrelated user changes and never use blanket staging without reviewing everything it includes.
- Check the staged diff for accidental secrets, local recordings, databases, model weights, generated build output and unrelated edits. Do not commit private lecture content or credentials.
- Run the appropriate checks and `git diff --check`. Documentation-only changes need documentation/link/whitespace checks, not unnecessary application tests. Report blockers and incomplete verification honestly; do not call a feature complete while required work remains.
- Use a descriptive commit message, normally `feat:`, `fix:`, `docs:`, `refactor:`, `test:` or `chore:`. Add a body when the reason, compatibility impact or validation needs explanation.
- If an authorized task changes both separate repositories, create a focused commit in each changed repository. Do not create empty commits in unchanged repositories.
- Commit before the final task report and include the commit hash and concise scope. If a Git permission, hook or signing failure prevents the commit, report it explicitly rather than claiming completion.
- This authorization covers local commits only. Do not push, amend existing commits, rebase, rewrite history or create a release unless separately authorized.
