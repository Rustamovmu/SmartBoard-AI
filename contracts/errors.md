# Errors — version 1

Current HTTP failures use `{ statusCode, code, message }`. They do not echo URLs, query strings, request bodies, exception text or stacks. Responses use `Cache-Control: no-store`. Unexpected/server exceptions log a fixed message and numeric status only. Business-specific safe errors and field validation will be added with actual features; raw validation values must never be returned or logged.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| VALIDATION_ERROR | 400 | Invalid request |
| UNAUTHENTICATED | 401 | Authentication required |
| FORBIDDEN | 403 | Access denied |
| NOT_FOUND | 404 | Unknown endpoint/resource |
| METHOD_NOT_ALLOWED | 405 | Rejected method, when explicitly emitted |
| PAYLOAD_TOO_LARGE | 413 | Input size limit |
| UNSUPPORTED_MEDIA_TYPE | 415 | Unsupported content type |
| RATE_LIMITED | 429 | Rate limit reached |
| SERVICE_UNAVAILABLE | 503 | Required service unavailable |
| INTERNAL_ERROR | 500 or other unmapped 5xx | Unexpected server failure |
| REQUEST_REJECTED | Other unmapped 4xx | Generic rejection |

`DEVICE_REVOKED`, `ANALYSIS_BUSY` and `VISION_UNAVAILABLE` are reserved for future identity/analysis features. They are not emitted by B1. GraphQL/WebSocket error adapters will use the shared codes but require separate transport implementations; the current filter is HTTP-only. GraphQL lists will use `{ items, page, pageSize, total }`.

Health readiness is a diagnostic response rather than an exception. It returns 200 with `{ status: "ready", checks: { platformDatabase: "up", transactions: "supported" } }` when read-only dependency probes pass. Otherwise it returns 503 with `status: "not_ready"`; `platformDatabase` is `up`/`down` and `transactions` is `supported`/`unsupported`/`unknown`. This checks topology support, not transaction permissions or feature completion. Liveness is 200 with `{ status: "ok" }`. Both are public and expose no database URI or credentials. See [health API examples](../docs/Health_API.md).

`DEVICE_STORAGE_FULL`, `LOCAL_SAVE_FAILED`, `PERMISSION_DENIED` and `FILE_MISSING` are local client errors. They must never imply a server has saved private content.
