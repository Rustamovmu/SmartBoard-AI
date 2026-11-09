# Device enrollment — version 1

Implemented at `POST /graphql`; see the versioned [schema](schema.graphql). Public authentication remains HTTP. This is platform enrollment, not hardware attestation or phone-storage implementation. The default-off [native connection foundation](analysis-transport.md) now provides access tickets and analyze/control sockets without image processing.

## Identity and lifecycle

1. Sign in on the target native client through `/auth/login` or `/auth/signup`. Its opaque credentials belong in Keychain/Keystore-backed secure storage; the native adapter is still unimplemented here.
2. Call `createDevicePairing` from that native session, supplying an enrollment label and `ANDROID` or `IOS`. Labels are 1–80 characters, start with a Unicode letter/digit and contain only letters, digits, spaces, `.`, `_`, `(`, `)` or `-`. Use a device label, never a lecture title or note. Device/platform labels are user assertions, not verified hardware identifiers.
3. The target receives a cryptographically random 256-bit base64url code once, with an ISO UTC expiry five minutes later. Present/transfer it deliberately to the account owner. Never put it in a URL, log, analytics event or saved Postman example. MongoDB stores only its SHA-256 hash. One request exists per target session; creating another immediately supersedes the previous code. A lost response requires creating a replacement.
4. From a **different authenticated session of the same account**, call `confirmDevicePairing`. Browser approval requires the existing trusted-origin/cookie/CSRF transport. An admin cannot approve another account's request. The target cannot approve its own request. This is same-account approval, not MFA: another login with the same password can approve it.
5. A transaction checks the live actor, target account version/session/lifetime, code expiry and single use; creates the device; binds the target session; consumes the code; and writes an audit event. Any failure rolls everything back. TTL cleanup is housekeeping; expiry is enforced in the transaction. The target can refresh while waiting, and the binding survives refresh without extending its original session lifetime.
6. The target polls `currentDevice` with its existing credentials. It returns `null` before approval; after approval it returns the enrolled device. No credential is passed between devices. GraphQL context is request-scoped: poll in a subsequent request after approval, rather than relying on another field in the same operation to refresh context.

Each account can have at most 20 ACTIVE device records. Creating a request uses a budget of 5/account/minute, confirmation attempts 10/account/minute, revocations 20 submitted device IDs/account/minute, in addition to GraphQL's 60/IP/minute and 60/account/minute limits. Buckets use UTC epoch minutes. Failed business attempts consume their budget. Single and [bulk revocations](device-batches.md) share the revocation budget; each submitted ID costs one, including already-revoked IDs. Rejected GraphQL/DTO shapes consume only the outer GraphQL budget. Codes/labels are never rate-limit keys.

## Operations and exact examples

All examples require explicit `X-SmartBord-Client: native` and `Authorization: Bearer <access credential>`, or the documented [browser cookies/origin/CSRF](authentication.md). Do not send native credentials with browser origin/cookies. Supply JSON `{ "query": "...", "variables": { "input": ... } }` to `/graphql`. Device fields are `id userId label platform status createdAt revokedAt`; lists use `{ items, page, pageSize, total }`.

| Operation              | Required identity             | Variables (`input`)                                       | Expected result                            |
| ---------------------- | ----------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `createDevicePairing`  | Unbound native session        | `{ "label": "My Android", "platform": "ANDROID" }`        | One-time code and expiry                   |
| `confirmDevicePairing` | Different session, same owner | `{ "code": "<43-character pairing code>" }`               | ACTIVE device bound to target session      |
| `currentDevice`        | Any active account session    | No variables                                              | Own session's device, or `null` if unbound |
| `myDevices`            | Active account                | `{ "page": 1, "pageSize": 20, "status": "ACTIVE" }`       | Only own devices                           |
| `adminDevices`         | Current ADMIN                 | `{ "userId": "<owner UUID>", "page": 1, "pageSize": 20 }` | Devices for the specified account          |
| `revokeDevice`         | Device owner                  | `{ "id": "<device UUID>" }`                               | REVOKED device and ISO UTC revocation time |
| `adminRevokeDevice`    | Current ADMIN                 | `{ "id": "<device UUID>" }`                               | Same revocation, audited as ADMIN          |

```graphql
mutation Start($input: CreateDevicePairingInput!) {
  createDevicePairing(input: $input) {
    code
    expiresAt
  }
}
mutation Approve($input: ConfirmDevicePairingInput!) {
  confirmDevicePairing(input: $input) {
    id
    userId
    label
    platform
    status
    createdAt
    revokedAt
  }
}
query BoundDevice {
  currentDevice {
    id
    userId
    label
    platform
    status
    createdAt
    revokedAt
  }
}
query OwnDevices($input: DevicesInput!) {
  myDevices(input: $input) {
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
query AccountDevices($input: AdminDevicesInput!) {
  adminDevices(input: $input) {
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
mutation Revoke($input: RevokeDeviceInput!) {
  revokeDevice(input: $input) {
    id
    status
    revokedAt
  }
}
mutation AdminRevoke($input: RevokeDeviceInput!) {
  adminRevokeDevice(input: $input) {
    id
    status
    revokedAt
  }
}
```

Send each operation separately. Pagination defaults to page 1/pageSize 20; bounds are page 1–10000 and pageSize 1–100. `status` is optional but explicit null is rejected. Unknown/private fields, operator objects, invalid UUIDs/enums/codes/labels and null required values are rejected. `userId` is accepted only by the admin list; owners cannot choose another owner for pairing, lists or revocation.

Unknown/expired/used/superseded/foreign codes and foreign/missing devices return `NOT_FOUND` with a generic message. Self-approval/browser initiation/non-admin administrator operations return `FORBIDDEN`. An already-bound target, inactive/expired/version-revoked target session or reached active-device cap returns `CONFLICT`. Rejected/unavailable authentication, origin/CSRF, rate and setup checks use the existing [safe error contract](errors.md). No raw input, code, hash or stack is returned. Revoked bound credentials return `UNAUTHENTICATED`; reserved `DEVICE_REVOKED` is not emitted by this increment.

## Revocation and concurrency

Revocation atomically marks the device REVOKED, revokes every session bound to its ID, and appends a bounded audit event. Repeating it from a still-valid owner/admin session returns the same device without another event. Self-revocation succeeds once; the requesting session is unusable on subsequent requests. Other sessions/devices of that account are unaffected.

Access authentication and refresh independently check bound device existence, owner and ACTIVE status; missing/revoked/wrong-owner devices fail closed. Refresh and revocation write the same session document, so a raced refresh cannot yield credentials usable after revocation commits. Enrollment and revocation share the existing `admin-policy-v1` transaction lock with account role/status changes and CLI bootstrap. This serializes approvals, caps and current actor checks against account blocking; it is a deliberate low-volume platform lock, not a stream-processing lock. Audit contains action, actor role/user, subject user/device and timestamp, never label, code or lecture content. Labels remain only in enrollment records.

Account blocking/role changes revoke all account sessions under the existing auth-version policy. Device records remain as platform inventory; reactivation restores no old session. Logout also leaves inventory intact. Revocation is permanent for that record; a new login is unbound and requires a new explicit enrollment, producing a new device ID. Login accepts no device ID or pairing code. This increment binds enrollment to one auth-session family, not to a permanent phone hardware identity; future persistent reattachment requires a separately reviewed credential contract.

Unbound sessions retain existing account operations. `/analysis/access` must require a live enrolled-device binding as well as current account status. The native connection foundation validates the live bound session and closes streams after polling detects revocation; see its contract for detection delay and cleanup limits. No operation wipes phone files, catalog or exports. [Atomic selected-device batches](device-batches.md) add `revokeDevices` and `adminRevokeDevices` without enabling GraphQL HTTP request batching.

## Setup, tests and cleanup

Explicit `npm run db:prepare` additionally prepares `devices`, `pairingRequests` and their indexes, plus the auth-session device lookup index. No startup/request creates indexes or collections. Enrollment operations fail closed until required device lookup, unique code and TTL indexes exist. Current health readiness still checks database topology and auth indexes only; it does not establish enrollment or future analysis readiness. Repeated preparation preserves records and does not drop indexes. Application setup is an operator action, separate from disposable tests.

`npm run test:integration` and `npm run postman:test` require the dedicated `MONGODB_TEST_URI`. They generate exact `sbt_<32 hex digits>` databases, verify initial emptiness and exact identity, create synthetic accounts, and close their temporary loopback apps/drop only their own database in cleanup. Never run the examples against application records as test fixtures. The collection has no live response examples or saved credentials; runtime codes/tokens are not exported. Real browser HTTPS, native credential adapters, real phone enrollment UI/storage and active-stream revocation remain unverified or unimplemented.

References: [Mongoose transaction/retry and sequential session operations](https://mongoosejs.com/docs/transactions.html), [Node 24 cryptographic randomness](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandombytessize-callback).
