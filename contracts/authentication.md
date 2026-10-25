# Authentication contract — version 1

Implemented HTTP contract, separate from future GraphQL, enrollment and analysis. [Public types](../src/contracts/auth-v1.ts) have no Nest/Mongoose imports. IDs are opaque UUIDs and timestamps ISO UTC. No lecture ID, file path, note, media or OCR field is accepted.

## Credential policy

Passwords have 12–128 characters at signup, 1–128 at login, and are not trimmed. Argon2id uses 64 MiB, three iterations, one lane and a 32-byte hash. Unknown logins perform a dummy verification; at most two password operations run concurrently per app instance. Passwords/hashes are never returned or logged. Email is trimmed/lowercased, validated and protected by a required unique index. Names are trimmed, nonempty and at most 80 characters.

Access credentials are random opaque tokens, not client-decodable role claims. SHA-256 hashes of high-entropy credentials are stored in `authSessions`. Access lasts 15 minutes, clamped to the session's fixed 30-day maximum. Refresh includes a random family authenticator and a rotated random secret; only hashes are stored. The session ID identifies its revocation family. Every protected request verifies the active session and current database account/status/version; role checks use the current account.

Refresh rotates both credentials atomically and immediately invalidates old access. Reusing an old refresh credential with a valid family authenticator revokes that family. Concurrent refreshes do not both succeed: one rotation can succeed, then replay revokes the family. **Clients must serialize refresh and sign in again after a lost refresh response.** There is no retry/grace archive or recovery of rotated raw credentials. Independent logins are separate families. Logout is idempotent and revokes only the presented family, including a stale valid family credential. Expiry/revocation checks do not rely on eventual TTL deletion.

Public signup creates USER/ACTIVE only; role/status/user IDs and all unknown fields are rejected. There are no role/status mutation endpoints yet. Future administrator account changes must transactionally advance `authVersion`, revoke sessions/access and protect the last active administrator. Connected-stream revocation requires the future WebSocket/enrollment implementation; this increment does not claim it.

## Shared request rules

All auth requests require `X-SmartBord-Client: native` or `browser`. POST requires `Content-Type: application/json`; send `{}` for a body with no fields. HTTP JSON is limited to 8 KiB; oversized/malformed bodies return 413/400 without reflecting input. Unknown fields return 400 `VALIDATION_ERROR`. All auth responses use `Cache-Control: no-store`.

Native requests must carry no Origin or Cookie header. `GET /auth/me` uses `Authorization: Bearer <accessToken>`; refresh/logout take `{ "refreshToken": "<credential>" }`. Tokens must be stored in the future native Keychain/Keystore adapter, not ordinary SQLite/localStorage. Backend tests cannot prove that adapter exists.

Browser requests require an exact HTTPS Origin in `AUTH_BROWSER_ORIGINS` (comma-separated; development default `https://localhost:3000`). They cannot use Authorization or body refresh credentials. Credential cookies are `__Host-sb_access` and `__Host-sb_refresh`, always Secure, HttpOnly, SameSite=Strict, host-only, `Path=/`. Browser JavaScript receives no access/refresh credential in JSON.

First call `GET /auth/csrf` with the browser headers and credentials enabled. It returns `{ "csrfToken": "<random nonce>" }` and a Secure/HttpOnly/Strict host-only `__Host-sb_csrf` cookie. Every browser POST must send that nonce as `X-CSRF-Token` along with its cookie. Origin and custom-header checks accompany constant-time comparison of bounded ASCII nonce values; duplicate cookies are rejected. Browser GETs still require the allowed Origin. Web/API hosting must be same-site over trusted HTTPS. Postman/synthetic HTTP tests manually supply cookie headers and do not prove actual browser cookie delivery.

## Endpoints and payloads

These operations have no GraphQL Variables. Prerequisites are prepared platform schemas/indexes and reachable transaction-capable MongoDB with suitable permissions. No administrator identity is required for public identity operations; `me` requires the current authenticated account.

| Endpoint | Body / identity | Expected success | Main rejections |
| --- | --- | --- | --- |
| POST /auth/signup | `{ "email": "person@example.test", "name": "Person", "password": "<12–128 chars>" }` | 201; user and session grant | 400 invalid/unknown fields; 409 duplicate email; 429 limit |
| POST /auth/login | `{ "email": "person@example.test", "password": "<password>" }` | 200; user and session grant | 401 wrong/unknown/inactive credentials; 429 limit |
| POST /auth/refresh | Native refresh JSON; browser `{}` + cookies/CSRF | 200; rotated grant | 401 missing/expired/replayed credential; 403 browser origin/CSRF |
| POST /auth/logout | Native refresh JSON; browser `{}` + cookies/CSRF | 200 `{ "success": true }`; browser cookies cleared | 400 malformed body; 403 origin/CSRF; 429 limit |
| GET /auth/me | Native bearer or browser access cookie | 200 `{ "user": { ... } }` | 401 invalid/expired/revoked session; 403 inactive account |
| GET /auth/csrf | Browser headers only | 200 `{ "csrfToken": "<nonce>" }` | 400 wrong client; 403 missing/unapproved Origin |

Public user shape: `{ id, email, name, role, status, createdAt }`. Native grants are `{ user, accessToken, refreshToken, accessExpiresAt, sessionExpiresAt }`. Browser grants are `{ user, accessExpiresAt, sessionExpiresAt }` plus cookies. Do not print, export or commit real credentials. Signup user+session and refresh changes use MongoDB transactions; signup session failure rolls the user insertion back.

Limits use MongoDB fixed one-minute buckets: signup 10/IP, login 20/IP and 5/normalized email, other auth endpoints 60/IP. Persisted attempt identifiers are hashes, not raw email/IP. TTL removes expired buckets eventually. Forwarded IP headers are not trusted by default; review proxy configuration before production. Missing required auth indexes returns 503 instead of accepting unprotected duplicate emails or unbounded rate records.

## Explicit schema/admin commands

`npm run db:prepare` creates `users`, `authSessions`, `authAttempts`, `auditEvents` and their declared indexes. It inserts no account, removes no record and drops no index. Automatic collection/index creation stays disabled in connection options. A conflicting index/setup failure needs inspection, not destructive automatic repair.

`npm run admin:create` requires `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`. Supply the password via a local hidden prompt/secret manager, not a literal command line, shell history, committed file or chat. For an interactive Bash terminal:

```bash
read -r -p 'Administrator email: ' ADMIN_BOOTSTRAP_EMAIL
read -r -p 'Administrator name: ' ADMIN_BOOTSTRAP_NAME
read -r -s -p 'Administrator password: ' ADMIN_BOOTSTRAP_PASSWORD
export ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_NAME ADMIN_BOOTSTRAP_PASSWORD
npm run admin:create
unset ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_NAME ADMIN_BOOTSTRAP_PASSWORD
```

Bootstrap creates a new ADMIN and `ADMIN_BOOTSTRAPPED` audit event in one transaction. It never promotes/overwrites an existing email, supplies a default password or promotes the first signup. The audit stores a subject ID, local-command actor type and time, without credentials/content. This task tested the CLI using disposable fixtures only and did not create a real administrator.

## Verification and remaining work

[Postman requests/results](../docs/Postman_Auth_Verification.md) and `test/auth.integration-spec.ts` cover real disposable MongoDB behavior. Tests mutate only generated fixtures to simulate expiry/blocking/roles and close/drop their own resources. Native secure storage, real browser HTTPS, user/admin mutation policy including last-admin protection, enrollment, email/recovery delivery, GraphQL and connected-stream revocation remain unimplemented or unverified. No private phone recording is created, accessed or erased by any auth command.

Implementation references: [Nest validation](https://docs.nestjs.com/techniques/validation), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
