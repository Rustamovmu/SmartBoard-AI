# Health API examples

These are documented HTTP examples, not saved Postman requests. The routes are public and need no user/admin identity, variables, tokens or request body. They change no records. Readiness checks dependencies and does not certify that authentication or analysis is implemented.

Prerequisites: Node.js 24, installed dependencies, a configured dedicated `SmartBoardAI` MongoDB connection in ignored local configuration, and an available loopback port. For deterministic automated scenarios, the E2E suites inject explicit synthetic connections; they never modify real records to simulate outages.

## Liveness

```http
GET /health/live HTTP/1.1
Host: 127.0.0.1:3000
```

Expected success: 200, `Cache-Control: no-store`, JSON `{ "status": "ok" }`. It reports that the API process is responding, independently of subsequent database outages. An initial connection failure prevents the app from starting.

## Readiness

```http
GET /health/ready HTTP/1.1
Host: 127.0.0.1:3000
```

Expected success: 200, `Cache-Control: no-store`:

```json
{ "status": "ready", "checks": { "platformDatabase": "up", "transactions": "supported" } }
```

Expected rejection when an established connection is down or probes fail: 503 with `status: "not_ready"`, `platformDatabase: "down"`, `transactions: "unknown"`. A reachable standalone/unsupported topology returns 503 with `platformDatabase: "up"`, `transactions: "unsupported"`. No connection strings, database names, credentials or driver errors are exposed.

## Unknown/private-content endpoints

For example, `POST /uploads/videos`, `GET /lectures`, and `DELETE /admin/devices/example/wipe` return 404:

```json
{ "statusCode": 404, "code": "NOT_FOUND", "message": "Route not found." }
```

These examples cover known forbidden paths; all future API/schema changes still require privacy review. There is no lecture upload/download route or private phone library API.

## Running and cleanup

```bash
npm run build
npm run start:prod
```

In a separate terminal:

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
```

Use Ctrl-C in the server terminal afterward; shutdown closes its app-owned database connection. No database cleanup is required because these requests write no data. The documented manual curl examples were not executed against the user's database; automated HTTP evidence uses synthetic connections. The live `db:check` evidence is recorded separately in [database setup](Database_setup.md).
