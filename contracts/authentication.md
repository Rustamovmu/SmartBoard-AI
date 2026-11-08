# Authentication contract — version 1

Implemented HTTP identity contract, separate from [GraphQL accounts](platform-accounts.md), [device enrollment](device-enrollment.md) and future analysis. [Public types](../src/contracts/auth-v1.ts) have no Nest/Mongoose imports. IDs are opaque UUIDs and timestamps ISO UTC. No lecture ID, file path, note, media or OCR field is accepted.

## Credential policy

Passwords have 12–128 characters at signup/reset, 1–128 at login, and are not trimmed. Argon2id uses 64 MiB, three iterations, one lane and a 32-byte hash. Unknown logins perform a dummy verification; at most two password operations run concurrently per app instance. Passwords/hashes are never returned or logged. Email is trimmed/lowercased, validated and protected by a required unique index. Names are trimmed, nonempty and at most 80 characters. Optional signup usernames have a distinct unique normalized identity; see [username login and owner choice](usernames.md).

Access credentials are random opaque tokens, not client-decodable role claims. SHA-256 hashes of high-entropy credentials are stored in `authSessions`. Access lasts 15 minutes, clamped to the session's fixed 30-day maximum. Refresh includes a random family authenticator and a rotated random secret; only hashes are stored. The session ID identifies its revocation family. Every protected request verifies the active session and current database account/status/version; role checks use the current account.

Refresh rotates both credentials atomically and immediately invalidates old access. Reusing an old refresh credential with a valid family authenticator revokes that family. Concurrent refreshes do not both succeed: one rotation can succeed, then replay revokes the family. **Clients must serialize refresh and sign in again after a lost refresh response.** There is no retry/grace archive or recovery of rotated raw credentials. Independent logins are separate families. Logout is idempotent and revokes only the presented family, including a stale valid family credential. Expiry/revocation checks do not rely on eventual TTL deletion.

Public signup creates USER/ACTIVE only; role/status/user IDs and all unknown fields are rejected. [Administrator GraphQL access changes](platform-accounts.md) transactionally advance `authVersion`, revoke all target sessions and protect the last active administrator, including concurrent changes. Connected-stream revocation requires the future WebSocket implementation; this increment does not claim it.

## Shared request rules

All auth requests require `X-SmartBord-Client: native` or `browser`. POST requires `Content-Type: application/json`; send `{}` for a body with no fields. Authentication JSON is limited to 8 KiB; oversized/malformed bodies return 413/400 without reflecting input. Unknown fields return 400 `VALIDATION_ERROR`. All auth responses use `Cache-Control: no-store`.

Native requests must carry no Origin or Cookie header. `GET /auth/me` uses `Authorization: Bearer <accessToken>`; refresh/logout take `{ "refreshToken": "<credential>" }`. Tokens must be stored in the future native Keychain/Keystore adapter, not ordinary SQLite/localStorage. Backend tests cannot prove that adapter exists.

Browser requests require an exact HTTPS Origin in `AUTH_BROWSER_ORIGINS` (comma-separated; development default `https://localhost:3000`). They cannot use Authorization or body refresh credentials. Credential cookies are `__Host-sb_access` and `__Host-sb_refresh`, always Secure, HttpOnly, SameSite=Strict, host-only, `Path=/`. Browser JavaScript receives no access/refresh credential in JSON.

First call `GET /auth/csrf` with the browser headers and credentials enabled. It returns `{ "csrfToken": "<random nonce>" }` and a Secure/HttpOnly/Strict host-only `__Host-sb_csrf` cookie. Every browser POST must send that nonce as `X-CSRF-Token` along with its cookie. Origin and custom-header checks accompany constant-time comparison of bounded ASCII nonce values; duplicate cookies are rejected. Browser GETs still require the allowed Origin. Web/API hosting must be same-site over trusted HTTPS. Postman/synthetic HTTP tests manually supply cookie headers and do not prove actual browser cookie delivery.

## Endpoints and payloads

These operations have no GraphQL Variables. Prerequisites are prepared platform schemas/indexes and reachable transaction-capable MongoDB with suitable permissions. No administrator identity is required for public identity operations; `me` requires the current authenticated account.

| Endpoint                  | Body / identity                                                                                                    | Expected success                                                | Main rejections                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST /auth/signup         | `{ "email": "person@example.test", "username": "person_42", "name": "Person", "password": "<12–128 chars>" }`      | 201; user and session grant                                     | 400 invalid/unknown fields; 409 duplicate email/username; 429 limit   |
| POST /auth/login          | `{ "identifier": "person_42 or person@example.test", "password": "<password>" } (legacy email also accepted)`      | 200; user and session grant                                     | 401 wrong/unknown/inactive credentials; 429 limit                     |
| POST /auth/refresh        | Native refresh JSON; browser `{}` + cookies/CSRF                                                                   | 200; rotated grant                                              | 401 missing/expired/replayed credential; 403 browser origin/CSRF      |
| POST /auth/logout         | Native refresh JSON; browser `{}` + cookies/CSRF                                                                   | 200 `{ "success": true }`; browser cookies cleared              | 400 malformed body; 403 origin/CSRF; 429 limit                        |
| POST /auth/password/reset | `{ "recoveryToken": "<operator-issued proof>", "password": "<12–128 chars>" }`; browser origin/CSRF still required | 200 `{ "success": true }`; all sessions revoked, no login grant | 400 invalid/private fields; 401 invalid/expired/used proof; 429 limit |
| GET /auth/me              | Native bearer or browser access cookie                                                                             | 200 `{ "user": { ... } }`                                       | 401 invalid/expired/revoked session; 403 inactive account             |
| GET /auth/csrf            | Browser headers only                                                                                               | 200 `{ "csrfToken": "<nonce>" }`                                | 400 wrong client; 403 missing/unapproved Origin                       |

Public user shape: `{ id, email, username, name, role, status, createdAt } (`username` is nullable)`. Native grants are `{ user, accessToken, refreshToken, accessExpiresAt, sessionExpiresAt }`. Browser grants are `{ user, accessExpiresAt, sessionExpiresAt }` plus cookies. Do not print, export or commit real credentials. Signup user+session and refresh changes use MongoDB transactions; signup session failure rolls the user insertion back.

Limits use MongoDB fixed one-minute buckets: signup 10/IP, login 20/IP and 5/account shared by email/username aliases (unknown identifiers use normalized-identifier buckets), reset 10/IP and 5/hashed proof, other auth endpoints 60/IP. Persisted attempt identifiers are hashes, not raw account IDs, identifiers or IP. TTL removes expired buckets eventually. Forwarded IP headers are not trusted by default; review proxy configuration before production. Missing required auth indexes returns 503 instead of accepting unprotected duplicate emails/usernames or unbounded rate records.

## Explicit schema/admin commands

`npm run db:prepare` creates `users`, `authSessions`, `authAttempts`, `auditEvents`, `platformSettings`, `devices`, `pairingRequests` and their declared indexes, and inserts the singleton administrator policy if absent. It inserts no account, removes no record and drops no index. Automatic collection/index creation stays disabled in connection options. A conflicting index/setup failure needs inspection, not destructive automatic repair.

`npm run admin:create` requires `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`. Supply the password via a local hidden prompt/secret manager, not a literal command line, shell history, committed file or chat. For an interactive Bash terminal:

```bash
read -r -p 'Administrator email: ' ADMIN_BOOTSTRAP_EMAIL
read -r -p 'Administrator name: ' ADMIN_BOOTSTRAP_NAME
read -r -s -p 'Administrator password: ' ADMIN_BOOTSTRAP_PASSWORD
export ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_NAME ADMIN_BOOTSTRAP_PASSWORD
npm run admin:create
unset ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_NAME ADMIN_BOOTSTRAP_PASSWORD
```

Bootstrap acquires the shared administrator policy and creates a new ADMIN and `ADMIN_BOOTSTRAPPED` audit event in one transaction. It never promotes/overwrites an existing email, supplies a default password or promotes the first signup. The audit stores a subject ID, local-command actor type and time, without credentials/content. This task tested the CLI using disposable fixtures only and did not create a real administrator.

## Operator-assisted password recovery

`npm run recovery:issue` is an explicit privileged local command requiring a verified ACTIVE account, private-pipe output opt-in and separate diagnostic stream. It issues one 15-minute random proof, storing only a hidden hash/expiry/auth-version tuple on the account. There is no production HTTP/GraphQL issuer. `POST /auth/password/reset` consumes the proof and atomically updates the Argon2id hash, advances auth version, revokes all sessions and writes an audit event; role/status and phone files are preserved. Browser success clears cookies. No automatic login or email delivery occurs. See [exact CLI invocation, requests, limits and setup](password-recovery.md).

## Verification and remaining work

[Postman requests/results](../docs/Postman_Auth_Verification.md) and `test/auth.integration-spec.ts` cover real disposable MongoDB behavior. Tests mutate only generated fixtures to simulate expiry/blocking/roles and close/drop their own resources. Real MongoDB administrator/GraphQL checks are recorded in [account operations](platform-accounts.md). Device-bound sessions now additionally check current enrollment status during access authentication and refresh. The separate [Pages Router web verification](../../smartbord-ai-frontend-web/docs/Verification.md) records actual trusted-HTTPS browser signup/login, cookie delivery, CSRF, cross-tab refresh and logout against guarded disposable MongoDB. Native secure storage, email/notification delivery and connected-stream revocation remain unimplemented or unverified. Production web hosting and other browser engines are not certified by that local run. [Operator-assisted recovery](password-recovery.md) is implemented, including the private-pipe CLI and HTTP reset; its proof hash/expiry/version fields are hidden from ordinary selection and public DTOs. No private phone recording is created, accessed or erased by any auth command.

Implementation references: [Nest validation](https://docs.nestjs.com/techniques/validation), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Published [Help queries](help-center.md) and [community readers](community.md), including [public comments](community-discussion.md), use a separate credential-free `X-SmartBord-Client: public` mode at `/graphql`. Authentication endpoints do not accept this mode. GraphQL JSON is capped at 64 KiB with an 8 KiB document limit; this does not change the 8 KiB authentication limit. Public content requests issue no auth/CSRF cookies and cannot invoke account, enrollment or mutation roots.
