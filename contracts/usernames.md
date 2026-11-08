# Username login

Usernames are separate from full names and per-post public community names. They are unique, case-insensitive, trimmed and stored lowercase: 3–30 ASCII letters, numbers or underscores, starting with a letter (`^[a-z][a-z0-9_]{2,29}$`). An assigned username cannot be renamed or transferred; blocked/deleted accounts retain it. Usernames are platform account data, never phone lecture metadata.

## HTTP identity

Use the existing native or browser transport and [authentication prerequisites](authentication.md), including exact HTTPS browser Origin, cookies and CSRF. No administrator is required. All responses are no-store; passwords retain their original whitespace.

`POST /auth/signup` accepts:

```json
{
  "email": "person@example.test",
  "username": "person_42",
  "name": "Person",
  "password": "<12–128 characters>"
}
```

Success is 201 with a USER/ACTIVE session grant. Username is required by the website signup form but optional in the HTTP contract for compatibility with older clients. Omitted usernames remain absent in MongoDB and appear as `null` in authenticated account responses. Existing accounts are not backfilled. Invalid/null/unknown inputs return 400; duplicate email or username returns 409. Concurrent claims use the database's unique index; unsuccessful signup rolls back the user/session transaction.

`POST /auth/login` accepts either username or email in `identifier`:

```json
{ "identifier": "person_42", "password": "<password>" }
```

The legacy `{ "email": "person@example.test", "password": "<password>" }` remains supported. Supply exactly one of `identifier` or `email`; both/missing/malformed values return 400. Email values use exact normalized email lookup; other valid identifiers use exact normalized username lookup. Full names are not login aliases. Success is the existing 200 session grant. Unknown, wrong-password and inactive credentials return the existing generic 401; no role/status/password policy changes.

Login remains limited to 20 requests/IP/minute and five attempts/account/minute. Known email and username aliases resolve to the same opaque account-ID budget before password verification. Unknown identifiers use a normalized-identifier budget and dummy password verification. Only hashed bucket identifiers persist. This changes bucket keys at rollout, so already accumulated old email-keyed buckets do not carry into the new account-ID buckets.

## Existing-account choice

An ACTIVE USER or ADMIN chooses their own username once through protected `/graphql`:

```graphql
mutation SetMyUsername($input: SetMyUsernameInput!) {
  setMyUsername(input: $input) {
    id
    email
    username
    name
    role
    status
    createdAt
  }
}
```

Variables:

```json
{ "input": { "username": "person_42" } }
```

No target account ID is accepted. Current credentials/status are rechecked inside the transaction after acquiring the shared administrator policy lock. A new choice returns Account, with one `USERNAME_SET` audit recording actor/subject IDs, actor role and time, without copying the username, email or credentials. Audit failure rolls back the claim. The same normalized username is an idempotent no-op; a different existing username or another account's username returns `CONFLICT`. Invalid inputs return `VALIDATION_ERROR`; missing/inactive identity returns the existing authentication/authorization errors. Public-client mode cannot invoke the mutation. Browser mutation requires CSRF. It has a separate five-attempt/account/minute budget in addition to the existing GraphQL budgets.

`Account.username` and HTTP public-member username are nullable. Authenticated owners and administrator account lists may read them; public community DTOs continue using their separate chosen public names. Choosing a username changes no password, role, status, auth version, recovery proof or session. On the website `/account` shows the chooser only while no username is set. Confirmation explains permanence. Uncertain/conflicting responses lock writes until a successful current-account read reconciles the result; mutations are never automatically replayed.

## Setup and verification

Run explicit `npm run db:prepare` before updating running services. The additive `users` index `unique_normalized_username` is exactly `{username:1}`, unique and sparse, with no partial filter. No null default or user TTL index is added. Setup never assigns usernames or overwrites account records. Authentication/readiness/username choice fail closed without this index. Local CLI administrator bootstrap remains email-first; an administrator may then choose a username through their Account page.

Use only a generated, initially empty, guarded `sbt_<32 hex>` database for examples/tests, with prepared schemas and synthetic accounts. Close hosts/connections and verify exact identity before dropping only that owned database. Never create fixtures or simulate blocking in application accounts. See the [dated verification](../docs/Username_verification.md) and [website evidence](../../smartbord-ai-frontend-web/docs/Verification.md). This is API documentation and automated evidence, not saved live Postman examples or physical-phone acceptance.
