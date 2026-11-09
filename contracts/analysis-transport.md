# Native connection foundation — version 1

Implemented on 2026-11-09; see [verification](../docs/Analysis_transport_verification.md). This version-1 native connection foundation remains command-only: its grants and sockets report `vision: false` and `acceptsFrames: false`. A separate, explicitly opted-in [protocol-version-2 measurement bridge](analysis-media.md) can accept frames on version-2 analyze grants. It does not change V1 behavior or add capture decisions/save acknowledgments.

## Configuration and prerequisites

`ANALYSIS_TRANSPORT_ENABLED` accepts exactly `true` or `false` and defaults to `false`. Invalid values fail startup without echoing the supplied value. The existing ignored application configuration is not changed by this increment. Disabled grants return 503 `SERVICE_UNAVAILABLE`; disabled upgrades are rejected with 503. Readiness remains database/topology/core-auth readiness, not analysis readiness.

Use one backend process. Grants, hashes and connection state live only in that process's bounded memory and disappear on restart. Multi-instance routing is not supported. Deployment must provide trusted HTTPS/WSS, remove credential/body capture and honor connection timeouts; this task does not configure or certify production hosting.

Explicit schema preparation and active MongoDB transactions are existing operator prerequisites. `/analysis/access` checks authentication and enrollment indexes; it creates no collection/index. Access requires a native session bound through existing same-account device enrollment, with current ACTIVE account/device state. No role, user ID, device ID or lecture metadata is accepted from the client. Browser approval and administration continue through their existing HTTP/GraphQL APIs. There is no mobile authentication/UI implementation in this backend task.

## HTTP grant

There are no GraphQL Variables. Send one request to `POST /analysis/access` with:

```http
Content-Type: application/json
X-SmartBord-Client: native
Authorization: Bearer <native access credential>
```

The JSON body must be exactly `{}`. Query strings, nonempty objects, arrays, browser origins and cookies are rejected. Success is HTTP 201 with `Cache-Control: no-store`, no cookies, and:

```json
{
  "protocolVersion": 1,
  "streamId": "<ephemeral UUID>",
  "connectBefore": "<ISO UTC timestamp>",
  "expiresAt": "<ISO UTC timestamp>",
  "analyzeTicket": "<one-use 43-character base64url secret>",
  "controlTicket": "<different one-use 43-character base64url secret>",
  "capabilities": { "vision": false, "acceptsFrames": false }
}
```

The 256-bit random tickets are endpoint-specific. Only SHA-256 ticket hashes are retained in bounded server RAM. `connectBefore` is at most 30 seconds after issuance, capped at `expiresAt`. `expiresAt` is the earlier of the access/session expiries observed during HTTP authentication. Refresh never extends that original stream deadline.

Each grant reserves one stream for its enrolled device. Capacity includes unused grants: one/device, two/account, 32/process, at most two sockets/stream. Capacity rejection is 409 `ANALYSIS_BUSY`. Fixed minute grant budgets use existing hashed MongoDB rate counters: 30/IP and 10/account. Failed business/capacity attempts consume budget. Malformed/disabled requests fail before charging; unauthenticated requests charge only the IP budget after schema checks. Missing indexes/service availability returns 503, unavailable identity 401/403, bad input 400 and exhausted budgets 429. Responses never echo input or secrets.

## Socket upgrade and commands

Open exactly `/ws/analyze` or `/ws/control` with native WebSocket headers:

```http
X-SmartBord-Client: native
Authorization: Bearer <ticket for this endpoint>
```

Use the ticket in this header only. Do not put any credential in URLs, subprotocols, log output or saved examples. Browser-origin/cookie handshakes are forbidden. A normal access token cannot replace a socket ticket. Wrong endpoints/query strings return 404. Invalid, expired, consumed and endpoint-swapped tickets return generic 401. Duplicate credential/client headers are rejected. A ticket is consumed before asynchronous validation, so concurrent redemption has one winner; once redemption starts, a lost/failed upgrade requires a fresh grant after the reservation clears. Header/path rejection before redemption does not consume the ticket.

Either socket may connect first. Unused sibling tickets expire at `connectBefore`, without closing the connected sibling. A stream releases its reservation once it has no connected sockets, pending tickets or in-progress redemptions. A closed endpoint cannot reconnect with its consumed ticket. Close the sibling and let pending tickets expire before requesting a replacement. There is no reattachment credential or replay grace.

After a successful upgrade the server sends:

```json
{"protocolVersion":1,"streamId":"<assigned UUID>","type":"ready","endpoint":"analyze","expiresAt":"<ISO UTC>","capabilities":{"vision":false,"acceptsFrames":false}}
```

The only accepted application commands have exactly these three fields:

```json
{"protocolVersion":1,"streamId":"<assigned UUID>","type":"heartbeat"}
{"protocolVersion":1,"streamId":"<assigned UUID>","type":"status"}
{"protocolVersion":1,"streamId":"<assigned UUID>","type":"close"}
```

`heartbeat` and `status` return the same fixed `status` envelope with `state: "connected"`, capabilities and `code: "VISION_UNAVAILABLE"`. `close` sends `closed` then closes with 1000. No command can control another device or erase local files. No media/candidate/save-ack command is defined here; [future vision lifecycle requirements](live-protocol.md) remain inactive.

Errors use `protocolVersion`, `streamId`, `type: "error"`, a shared fixed `code` and safe `message`. Binary input returns `VISION_UNAVAILABLE` and closes with 1003. Invalid commands/JSON/version/stream/fields close with 1008; oversized messages close with 1009. Oversize rejection may occur at the WebSocket parser before an application error envelope can be sent.

## Limits, revocation and cleanup

- Compression disabled; maximum incoming message 8,192 bytes. No image decoding or large binary framing.
- Five application messages per socket per one-second window measured from its current window start; at most one synchronous command in progress and no command backlog. Exceeding capacity closes with 1013 `ANALYSIS_BUSY`.
- At most 16,384 queued outbound application bytes per socket. Slow consumers close with 1013; the close envelope is omitted when it would exceed this budget.
- Send a valid application heartbeat every ten seconds. Thirty seconds without a valid command closes the socket with 1000. WebSocket pings/pongs do not extend application activity.
- A read-only current binding check starts once/second per stream, shared by both sockets, with no overlapping periodic checks. It verifies session ownership/transport/lifetime/revocation, account status/auth-version and device ownership/status. Each check has a two-second deadline; unavailable storage closes with 1011 `SERVICE_UNAVAILABLE`.
- Logout, reset, role/status changes and device revocation invalidate the existing binding. Detection is polling-based: allow the one-second interval, up to 100 ms scheduler cadence and up to two seconds validation time, plus normal runtime scheduling. It is not instantaneous. Revoked identity closes both sockets with 1008 `UNAUTHENTICATED`; reactivation does not revive old grants.
- Normal refresh rotation preserves the established binding and pending tickets until the original stream expiry. No raw account access/refresh token is retained by the stream registry.
- Absolute expiry, revocation and shutdown remove the stream and ticket hashes. Final disconnect releases empty reservations. Shutdown closes with 1001. Every initiated close allows one second for the handshake, then terminates the socket. Timers/listeners and task-owned connections are cleaned up; late asynchronous results cannot restore removed streams.

The registry stores platform identity and bounded lifecycle metadata only. It has no lecture schema, filesystem writer, disk queue, persistent stream archive or worker. Protocol rejection briefly receives bounded bytes; it does not establish zero transmission or deployment-wide physical RAM-only guarantees.

## Disposable verification and cleanup

Run `npm run test:integration -- --runTestsByPath test/analysis-transport.integration-spec.ts` with only dedicated `MONGODB_TEST_URI` available through existing fixture configuration. The harness generates an exact `sbt_<32 hex>` name, verifies initial emptiness, prepares synthetic account/enrollment fixtures and enables the feature only in its test provider. It binds loopback on a random port and uses real WebSocket clients. The fixture owns its externally supplied MongoDB connection through final identity-guarded database deletion/connection closure, including the application-shutdown case.

Do not run fixture writes, reset, block or revoke examples against actual accounts. This increment adds no live Postman requests or saved response examples. Existing Postman automation remains regression coverage; dedicated Supertest/WebSocket tests cover this feature.
