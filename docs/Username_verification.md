# Username verification — 2026-11-08

Implemented [contract](../contracts/usernames.md): separate immutable normalized usernames, username-or-email login with legacy email payloads, nullable authenticated account username, optional HTTP-signup username for compatibility, required website-signup username, and one-time authenticated owner selection. No existing-account backfill or real-account username assignment occurred. References inspected: TripLink member input/service and Join UI; unrelated roles, fields and repository policies were not copied.

## Backend evidence

Passed non-writing TypeScript, clean lint, 103 unit tests, 18 HTTP tests, Nest build, schema generation, nine real-MongoDB integration suites / 135 tests, and official Postman CLI regression (83 requests / 322 assertions, zero failures). Integration added eleven username cases: normalized signup/login through both identifier kinds and legacy email; duplicate full names; legacy missing values and additive setup; invalid/null/operator/unknown/ambiguous inputs; concurrent normalized signup collision and transactional rollback; shared canonical login budget before password verification; USER/ADMIN one-time/idempotent choices with preserved password/version/sessions; authentication/status/ownership/CSRF/public boundaries; competing owners/choices; audit failure rollback and blocked-name reservation; missing-index failure/readiness and non-rewriting preparation.

An initial targeted run passed ten cases and failed one assertion expecting UNAUTHENTICATED for a blocked account; the existing correct response is FORBIDDEN. The assertion was corrected without weakening rejection. Final full integration passed all 135. The first HTTP test attempt could not bind loopback inside the sandbox; its permitted rerun passed all 18. Earlier type/lint/build passes were repeated as appropriate; no unexecuted check is counted as passed. No username-specific Postman request/example was added; username behavior is covered by Supertest/browser tests, while Postman proves the legacy regression.

All database fixtures use the dedicated test URI, initially empty exact sbt_<32 hex> names, identity-guarded cleanup and owned connection/app closure. No application credentials/accounts/media were used as test fixtures. Test commands started only necessary temporary loopback services and stopped their own resources. Existing user development hosts were preserved.

## Application metadata

The application pre-check reached transaction-capable SmartBoardAI: 12 collections, one known unexpected empty collection, no unexpected nonempty collection; exit 1 represents the preserved policy finding. Explicit `npm run db:prepare` succeeded: additive collections/indexes/policy setup only, no accounts created, no index/data deletion. It added the unique sparse username index without rewriting/backfilling existing accounts.

A separate listener-free read-only application context passed authentication (including the username index), recovery, enrollment, Help, post, comment and report schema assertions, then closed. No application-account login, username choice, password reset, administrator bootstrap, content publication, production deployment or push was performed.

## Website evidence

The separate website uses the existing auth/cross-tab lock, HTTP-only secure credentials, per-POST CSRF and request-scoped SSR. /account confirms permanent choice, preserves separate public names and requires read-only reconciliation after conflict or uncertain response. Code generation uses the copied versioned schema; no new dependency or lockfile change.

Browser checks and their final outcomes are recorded in [website Verification.md](../../smartbord-ai-frontend-web/docs/Verification.md). An initial username collision assertion also matched Next's route-announcer alert; it was scoped to main content. Combined username/admin plus recovery runs exposed incompatible fixed fixture totals (30 instead of 27); independent modes retain each original suite's strict assertions, and a new early preflight rejects that unsupported combination before resources start. Failed attempts confirmed owned host/database cleanup and preserved existing certificates. These are harness failures, not claimed passes.

Remaining scope: actual account owners choose their own usernames; no automatic assignment, rename/email/full-name editing, native sign-in UI, physical-phone proof, other browser engines or production hosting is certified here. Device-only lecture ownership is unaffected. Known empty-collection policy finding and existing dependency advisories remain separate.
