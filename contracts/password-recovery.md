# Operator-assisted password recovery — version 1

Implemented by `npm run recovery:issue` and `POST /auth/password/reset`. This is a local-operator recovery flow, with no public issuance, email delivery, automatic notification, recovery-code list or frontend reset screen. The operator must independently verify the account owner and deliver the proof through an approved private channel. Database/operator access is the issuance authority; a logged-in USER or ADMIN cannot issue proofs through HTTP/GraphQL.

## Local issuance

Prerequisites: Node.js 24, the configured platform database, an existing ACTIVE account and explicit `npm run db:prepare`. Issuance works for USER and ADMIN, including the last active admin, without changing role/status, password or current sessions. BLOCKED/DELETED/missing accounts are refused. It does not create or reactivate an account.

Supply `RECOVERY_ACCOUNT_EMAIL` only for the intended verified account. The CLI trims/lowercases it and validates its shape/length. Secret delivery requires **both** `--private-output` and a pipe/socket-backed output stream, separate from stderr. Terminal output, regular-file redirection and ordinary invocation are rejected before issuance. Use npm's `--silent` so its banner does not enter the private JSON channel. Normal application logs never contain a recovery proof.

Example for an operator choosing the local macOS clipboard as the recipient:

```bash
set -o pipefail
RECOVERY_ACCOUNT_EMAIL='verified-owner@example.test' \
  npm run --silent recovery:issue -- --private-output | pbcopy
```

The private channel receives only `{ "recoveryToken": "<secret>", "expiresAt": "<ISO UTC>" }`. Stderr carries a static success/failure message. The npm CLI delivery path was tested with an in-memory private recipient; actual `pbcopy`, clipboard synchronization/history and delivery to a real person were not exercised. An approved private recipient can replace `pbcopy`. The CLI cannot inspect what a downstream recipient does: do not pipe proofs to logs, `tee`, saved reports or publication tools. Do not merge diagnostic output into the secret pipe. Never put a proof in a URL, Git, command argument or normal application log.

Issuance commits before delivery. If delivery fails or the response is lost, explicitly reissue: the new proof replaces the previous one. No raw proof can be recovered from MongoDB. The script opens an application context/connection, never an HTTP listener, and closes its connection in `finally`.

## Credential and persistence policy

The proof is `sb_p.` followed by 43 base64url characters from 32 cryptographically random bytes. It expires 15 minutes after issuance and authorizes only a password reset for its bound account. One hidden tuple exists per account in `users`: `passwordRecoveryHash` (SHA-256), `passwordRecoveryExpiresAt` and `passwordRecoveryVersion` (the current `authVersion`). These fields default to absent and are excluded from ordinary Mongoose selection and public account DTOs/GraphQL.

Explicit setup creates the unique sparse `unique_password_recovery_hash` index. Recovery operations fail closed without it. No collection or dependency was added. **There is no TTL index on users**, which would risk deleting accounts. Expiry is checked directly; an unused expired tuple remains bounded to one per account until replacement or successful reset. Successful reset unsets all three fields.

Reissue immediately invalidates the prior proof. Role/status mutations invalidate existing proofs through the auth-version check; blocking/deletion refuses recovery, and later reactivation does not restore an old proof. Logout alone does not consume an independent recovery proof. Recovery does not modify account role/status or device inventory.

## HTTP request

Identity: possession of a valid operator-issued proof; no existing access/refresh token is required. Native clients send `X-SmartBord-Client: native` without Origin/Cookie headers. Browser clients use `X-SmartBord-Client: browser`, an allowed HTTPS Origin and matching CSRF cookie/header from `/auth/csrf`; access cookies are optional. The normal [authentication transport rules](authentication.md) apply.

Endpoint: `POST /auth/password/reset`, `Content-Type: application/json`.

```json
{
  "recoveryToken": "<operator-issued proof>",
  "password": "<new password, 12–128 characters>"
}
```

Passwords are not trimmed and use the existing Argon2id policy. The frontend should confirm the new password locally before submitting it; no confirmation UI is implemented here. No email, user ID, role, status, phone path, lecture data or other unknown field is accepted. JSON remains bounded to 8 KiB. Proofs/passwords belong in the request body, not query strings or telemetry.

Success: HTTP 200, `Cache-Control: no-store`, exactly `{ "success": true }`. No access/refresh credential is issued and no automatic login occurs. All previous sessions become unusable, including native device-bound and browser sessions. Browser success also clears access, refresh and CSRF cookies; obtain a fresh CSRF challenge and sign in normally afterward. Other accounts' server-side credentials/sessions are not revoked. The caller's browser cookies are cleared even if that browser was signed in as a different account. Device inventory and phone files/catalogs/exports remain intact; new login is unbound and follows the existing explicit re-enrollment contract.

## Transactions, audit and races

Issuance and reset acquire the same transactional administrator-policy write as account access changes, bootstrap and device enrollment/revocation. Issuance atomically replaces the tuple and adds `PASSWORD_RECOVERY_ISSUED` with `actorType: LOCAL_COMMAND`. Reset checks proof expiry/status/version before expensive password work and again inside the transaction after hashing/retries.

Successful reset atomically writes the new password hash, increments `authVersion`, unsets the proof, revokes every account session and appends `PASSWORD_RESET` with `actorType: RECOVERY_CREDENTIAL`. Audit fields contain only action, actor type, subject account ID and time; proof, password, hash, email and lecture content are absent. Audit failure rolls back all related changes. Invalid attempts do not change the password, status, role or sessions; their rate budget is separate from the transaction.

Two concurrent consumers cannot both succeed. Reissue/reset races serialize: only the newly issued proof can remain usable, bound to the account version at its issuance. Blocking/demotion during hashing makes the stale proof unusable. Existing login/session version checks ensure an old-password login racing reset cannot yield credentials usable afterward. Active WebSockets do not exist yet; their coordinated shutdown remains future work.

## Errors and limits

| Result                                                                      | HTTP      | Code / behavior                                                        |
| --------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| Malformed proof, weak/invalid password, unknown/operator/private fields     | 400       | `VALIDATION_ERROR`; proof not consumed                                 |
| Unknown, expired, used, superseded, inactive-account or stale-version proof | 401       | Same generic `UNAUTHENTICATED` response, without account/proof details |
| Browser origin/CSRF or mixed native/browser transport rejected              | 403       | `FORBIDDEN`                                                            |
| Oversized JSON / unsupported type                                           | 413 / 415 | Existing safe parser/transport errors                                  |
| Attempt or Argon2 capacity budget exhausted                                 | 429       | `RATE_LIMITED`; no password mutation                                   |
| Missing required recovery index/policy                                      | 503       | `SERVICE_UNAVAILABLE`                                                  |
| Unexpected/audit failure                                                    | 500       | `INTERNAL_ERROR`; transactional rollback                               |

Reset is limited to 10 requests/IP/epoch minute and 5 service attempts per hashed proof/epoch minute. Sensitive password work shares the existing two-operation per-instance Argon2 bound. Invalid proofs are rejected before hashing a new password. DTO failures consume the outer IP budget; service attempts consume the proof budget even if business validation/transaction later fails. No raw proof is a stored rate key. Local issuance is an explicit privileged command, not a remotely rate-limited recovery-request API.

Health readiness retains its core database/topology/auth-index checks; it does not prove recovery-index preparation. Before enabling this endpoint on the application database, run explicit schema preparation. No application setup, real-account issuance or reset was performed during this increment.

## Verification and cleanup

`npm run test:integration` requires the dedicated `MONGODB_TEST_URI`; it creates exact `sbt_<32 hex digits>` databases, verifies initial emptiness and guards exact configured/connected identity before cleanup. Tests use real hashing/indexes/transactions and the actual npm CLI with an in-memory private pipe. Ordinary/file-output refusals use an owned empty temporary file, removed afterward; no proof is written to it. Tests cover replay, supersession, expiry without deleting users, concurrent consumption, audit rollback, blocking/reactivation, roles/last-admin recovery, hashing races, reissue races, validation, budgets, setup and browser-wire CSRF/cookie clearing. Own listeners/connections close and owned databases are removed.

The [Postman collection](../postman/SmartBoardAI.postman_collection.json) receives one synthetic proof through `GET /__test/recovery-proof` **only in the disposable Postman host script**. It requires the verified test marker, fixes the target to a generated synthetic account, permits one retrieval and accepts no account selection. It is absent from AppModule/production controllers; integration tests verify that absence. No credential is saved to a collection/example/report or passed in CLI arguments. See [dated verification](../docs/Postman_Auth_Verification.md).

Email/notification delivery, independent human identity verification, real browser HTTPS, native secure storage/UI, clipboard delivery, phone persistence and active-stream revocation remain unimplemented or unverified. This implements the recovery backend, not full V2 acceptance.

Reference: [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) informed proof generation, expiry/single use, normal login afterward and session invalidation. The project's explicit no-credential-in-URL policy is retained.
