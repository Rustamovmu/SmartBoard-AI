# Platform account GraphQL contract — version 1

Implemented on 2026-11-02. The account surface in the versioned [schema](schema.graphql) exposes three operations at `POST /graphql`. [Device enrollment](device-enrollment.md) adds separate operations on the same boundary. Authentication stays at `/auth/*`; published-content operations are not implemented yet. No lecture/media fields, upload scalar, subscription or phone-file command exists.

## Transport and prerequisites

Use transaction-capable MongoDB and run `npm run db:prepare` explicitly. This prepares platform schemas/indexes and inserts the singleton `platformSettings` administrator policy if absent, preserving an existing revision. It creates no account and drops nothing. Bootstrap a real administrator only with the explicit [local command](authentication.md). No administrator was created in the application database during this increment.

Every account GraphQL request requires `Content-Type: application/json` and `X-SmartBord-Client: native` or `browser`. Native requests send `Authorization: Bearer <accessToken>` without Origin/Cookie headers. Browser requests send the allowed HTTPS Origin, access/CSRF cookies and `X-CSRF-Token` from `/auth/csrf`, including for queries. See [authentication](authentication.md). Credentials must not appear in URLs. Responses use `Cache-Control: no-store`.

Send `{ "query": "<operation>", "variables": { ... } }`. GraphQL JSON bodies are limited to 64 KiB, with an 8 KiB UTF-8 operation-document limit. [Published Help](help-center.md) and [community](community.md) additionally support an explicit credential-free public mode restricted to their four reader roots; account operations still require the identity and transport described here. Only one operation per document, at most five root fields, 80 total AST fields, six selection levels and six definitions are allowed. Pages allow 1–100 items; page number is 1–10000. Root field limits also apply to aliases and fragment definitions. Schema introspection, browser IDEs, HTTP batching and persisted queries are disabled. The server writes no runtime schema file; `npm run schema:generate` generates the handoff artifact without a database connection or listener. Integration tests compare it with the actual schema.

Current account/session/status is checked for every account request. GraphQL uses fixed one-minute limits of 60 requests/IP and 60/account, backed by hashed identifiers in expiring `authAttempts`. Proxy IP trust stays disabled. List totals and items are separate bounded reads and can differ during concurrent account changes.

## Current account

Identity: any current ACTIVE account with a valid session. It returns only that account, with no caller-supplied user ID.

```graphql
query CurrentAccount {
  currentAccount {
    id
    email
    name
    role
    status
    createdAt
  }
}
```

Variables: `{}`. Success: `data.currentAccount`, with an opaque UUID and ISO UTC `createdAt`. Password hashes, auth versions and credentials are not schema fields. Invalid/revoked credentials return `UNAUTHENTICATED`; inactive current accounts can return `FORBIDDEN`.

## Administrator account list

Identity: current ACTIVE ADMIN. USER requests return `FORBIDDEN`.

```graphql
query AdminAccounts($input: AccountsInput!) {
  adminAccounts(input: $input) {
    items {
      id
      email
      name
      role
      status
      createdAt
    }
    page
    pageSize
    total
  }
}
```

Variables: `{ "input": { "page": 1, "pageSize": 20, "role": "USER", "status": "ACTIVE" } }`. Omit role/status to include all accounts; explicit null is rejected. `{ "input": {} }` uses page 1 and size 20. Ordering is newest creation time first, then ID. Invalid bounds, enum values or unknown/private fields return `VALIDATION_ERROR`.

## Administrator access change

Identity: current ACTIVE ADMIN, rechecked inside the transaction after acquiring the shared administrator policy write.

```graphql
mutation AdminUpdateAccountAccess($input: UpdateAccountAccessInput!) {
  adminUpdateAccountAccess(input: $input) {
    id
    email
    name
    role
    status
    createdAt
  }
}
```

Variables: `{ "input": { "id": "<target UUID from a disposable fixture>", "status": "BLOCKED" } }`. At least one of `role` (`USER`/`ADMIN`) or `status` (`ACTIVE`/`BLOCKED`/`DELETED`) is required. Both may be supplied. Explicit null, invalid UUID, unknown fields and an empty change are rejected. A nonexistent target returns `NOT_FOUND`.

Every actual change atomically increments the target's `authVersion`, revokes all its authentication sessions and inserts one `ACCOUNT_ACCESS_CHANGED` audit event. That event stores only actor/subject platform IDs, previous/next role/status and time. If audit insertion fails, the account/session changes roll back. A no-op returns the existing public account without revocation or an audit event. Role changes require a fresh login; reactivation never restores old credentials.

`DELETED` is a reversible account status, not physical deletion or anonymization. It prevents login. An administrator can reactivate it. It never deletes phone files. No password/email/profile editing or recovery operation is included here.

The last ACTIVE ADMIN cannot be demoted, blocked or soft deleted: `CONFLICT`. Other administrators may perform those changes, and self-changes are allowed when another active administrator remains. All administrator mutations and CLI bootstrap first update the same singleton policy inside their MongoDB transaction. This serializes competing changes; retrying transactions recheck actor permissions and the active-admin count. A missing policy fails closed with `SERVICE_UNAVAILABLE`, requiring explicit setup. No count-only protection or automatic first-user promotion is used.

Device enrollment now binds native sessions to device records and provides audited device revocation. Account access changes revoke those bound sessions along with every other account session. Device inventory is preserved; reactivation restores no credentials. Connected streams do not exist yet; active-stream shutdown remains future work.

## Errors, disposable examples and cleanup

GraphQL failures contain only `{ "message": "<fixed safe message>", "extensions": { "code": "<stable code>" } }`. Resolver execution failures normally use HTTP 200 with `errors` and nullable `data`. Invalid syntax/schema/variables/document limits use HTTP 400; context authentication/origin/rate/setup failures use their 401/403/429/503 status. Unsupported methods/content types and parser failures use the safe HTTP envelope with 405/415/400/413. Unexpected failures return `INTERNAL_ERROR` without exception text, stack, input values, suggestions or locations. See [errors](errors.md).

`npm run test:integration` exercises real MongoDB races, role/IDOR rejection, revocation, last-admin checks, preparation and rollback. `npm run postman:test` runs saved HTTP requests for current account, USER rejection, admin pagination, block/reactivation, promotion/demotion, revocation and last-admin rejection. Its dedicated test host bootstraps one synthetic administrator only after checking that its generated `sbt_<32 hex digits>` database is empty. Runtime fixture credentials are derived from the random public test marker; they are intentionally disposable, loopback-only and never suitable for application use.

Prerequisite for both: dedicated `MONGODB_TEST_URI` with no database name and disposable create/index/read/write/transaction/drop permissions. They never fall back to application credentials. Every destructive cleanup verifies the exact generated/configured/connected name. Postman closes its listener before removing its own database. Integration apps close their own connections/listeners. No real account is changed for an example. See [dated Postman evidence](../docs/Postman_Auth_Verification.md).

Implementation references: [Nest Apollo setup](https://docs.nestjs.com/graphql/quick-start), [Nest GraphQL guards/context](https://docs.nestjs.com/graphql/other-features), [Apollo error formatting](https://www.apollographql.com/docs/apollo-server/data/errors), [Apollo CSRF prevention](https://www.apollographql.com/docs/apollo-server/security/cors).
