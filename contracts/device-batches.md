# Selected-device revocation batches — version 1

Implemented at `POST /graphql` on the existing authenticated [enrollment boundary](device-enrollment.md). This API revokes selected platform devices and their bound authentication sessions. Phone files, catalogs and exports remain outside backend authority. Account access mutations and frame analysis are not batch operations in this increment.

## Operations and identity

| Mutation             | Required identity      | Selection scope                                   |
| -------------------- | ---------------------- | ------------------------------------------------- |
| `revokeDevices`      | Current ACTIVE account | Every selected device must belong to the caller   |
| `adminRevokeDevices` | Current ACTIVE ADMIN   | Selected devices can belong to different accounts |

Both use `RevokeDevicesInput { ids: [ID!]! }`. Submit 1–20 distinct opaque device UUIDs. Empty/oversized selections, exact duplicate ID strings, invalid UUIDs, null items and unknown fields are rejected with `VALIDATION_ERROR`. GraphQL's standard list coercion also accepts a single ID as a one-item list; arrays are the canonical examples. Owner inputs accept no `userId` or authority flag. A USER cannot invoke the admin mutation, including for their own devices.

## Exact requests

Native transport requires `Content-Type: application/json`, `X-SmartBord-Client: native` and `Authorization: Bearer <access credential>`, without Origin/Cookie headers. Browser transport requires the existing Secure/HttpOnly cookies, allowed HTTPS Origin and `X-CSRF-Token`; see [authentication](authentication.md). Never put credentials in URLs.

```graphql
mutation RevokeSelectedDevices($input: RevokeDevicesInput!) {
  revokeDevices(input: $input) {
    items {
      id
      userId
      label
      platform
      status
      createdAt
      revokedAt
    }
    page
    pageSize
    total
  }
}
```

Variables: `{ "input": { "ids": ["<first owned device UUID>", "<second owned device UUID>"] } }`.

```graphql
mutation AdminRevokeSelectedDevices($input: RevokeDevicesInput!) {
  adminRevokeDevices(input: $input) {
    items {
      id
      userId
      label
      platform
      status
      createdAt
      revokedAt
    }
    page
    pageSize
    total
  }
}
```

Variables: `{ "input": { "ids": ["<selected device UUID>", "<another selected device UUID>"] } }`. Use IDs from disposable owner/admin fixture queries while testing. Each request body is `{ "query": "<one operation above>", "variables": { "input": { "ids": [...] } } }`.

Success returns a complete `DevicePage` in submitted ID order: `page: 1`, `pageSize: ids.length`, `total: ids.length`, with every selected device REVOKED. These counts describe the submitted selection, not the account's full inventory. There are no additional pages or pagination arguments for a batch. Timestamps are ISO UTC and IDs remain opaque.

## Atomicity, auditing and retries

One transaction acquires the shared administrator policy write, reauthenticates the actor and checks current ADMIN authority when required. It reads the complete permitted selection before writing. A missing or foreign ID rejects the entire owner selection with the same generic `NOT_FOUND`; even an ADMIN must supply existing IDs. The error identifies no failing ID, ownership or partial successes.

For all newly revoked devices, the transaction sets one common revocation timestamp, revokes every authentication session bound to any selected active device, and writes one `DEVICE_REVOKED` event per changed device. Each audit contains only platform actor/subject IDs, role/action and time. An error at any step, including a later audit insertion, rolls back all device, session and audit changes from the batch. No partial-result mode exists. The attempted rate-limit cost remains consumed outside the transaction.

Previously revoked records retain their original timestamp and do not produce another event. A permitted retry returns the same committed records, subject to the current rate budget. If a response is lost, query the device inventory rather than assuming failure or attempting a phone-file recovery. A batch may include the caller's bound device: it can return success, then that session's access/refresh credentials are unusable on subsequent requests. Other unselected sessions/devices retain their existing access.

Overlapping batches and single-device revocations serialize through the same policy transaction, so each device changes/audits once and later results preserve its original timestamp. Account blocking/demotion shares this ordering; a retried batch rechecks the actor's new authority. A concurrent refresh writes the same target session and cannot produce credentials usable after revocation commits. Existing single-device mutations use this same implementation and retain their response shape.

Atomicity applies to each named mutation invocation. Several mutation fields in one GraphQL operation still run as separate transactions. GraphQL HTTP request arrays remain disabled. This API does not enable generic request batching, server jobs or lecture queues.

## Limits and safe errors

All four single/bulk owner/admin revocation mutations share a **20 submitted IDs per actor account per epoch minute** budget. One single-device request costs 1; a selection of N devices costs N, including already-revoked selections and business-rule rejections. The budget reservation is atomic and a request that cannot fit fails with `RATE_LIMITED` before any revocation. Its rejected reservation does not increment the counter. Validation/guard failures before the revocation service consume only the outer GraphQL request budget. The existing 60 GraphQL requests/IP/minute and 60/account/minute, 8 KiB JSON body and document limits remain in force. No device ID or lecture content is used as a rate-limit key.

Resolver failures normally return HTTP 200 with a fixed safe GraphQL error; invalid GraphQL shapes use 400. Current authentication/origin/CSRF context checks retain their 401/403 responses. Missing preparation returns `SERVICE_UNAVAILABLE`; unexpected failures return `INTERNAL_ERROR` without input, exception text or stack. See [errors](errors.md). Revoked credentials still use `UNAUTHENTICATED`, without introducing a new device error code.

## Prerequisites, verification and cleanup

Requires the existing enrollment indexes/administrator policy prepared explicitly through `npm run db:prepare`, a transaction-capable MongoDB and valid account sessions. This increment adds no collections/indexes or dependency. It performs no automatic application setup.

`npm run test:integration` uses only `MONGODB_TEST_URI` and guarded generated `sbt_<32 hex digits>` databases. Tests verify initial emptiness before creating synthetic accounts/devices, then verify exact configured/connected identity before cleanup and close their own loopback hosts/connections. Cases cover the 20-device boundary, mixed ownership/missing IDs, duplicates/null/private inputs, weighted budgets, later-audit rollback, overlapping batches, concurrent admin demotion, self-revocation and browser-wire CSRF/origin.

`npm run postman:test` verifies the saved requests in the [collection](../postman/SmartBoardAI.postman_collection.json) against its own generated, verified-empty loopback fixture. It removes that exact database and closes its listener in `finally`. No live response example, raw report, saved credential, application record or real phone is used. See the dated [verification record](../docs/Postman_Auth_Verification.md). Native UI, phone storage and active WebSocket shutdown remain unimplemented/unverified.
