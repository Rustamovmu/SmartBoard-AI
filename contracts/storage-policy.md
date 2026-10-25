# Storage policy — version 1

This is a required cross-project contract. Its presence is not proof of deployed retention behavior. The framework-independent [contract constants](../src/contracts/platform-v1.ts) enumerate platform collections, representative forbidden endpoints and analysis limits.

## Ownership

Private video/audio, images, thumbnails, lecture titles, notes, OCR, PDFs, exports, capture history, calibration, accepted comparison baselines, recovery manifests and local file references belong exclusively in durable storage on the user's device. The phone uses SQLite for its catalog and persistent native files for media bytes. Preserve originals and save enhanced copies separately.

The backend must not persist these bytes or records in MongoDB, files, caches, logs, telemetry, temporary directories, backups or disk queues. No private media library, video upload, lecture CRUD, server export, lecture sync or remote phone-wipe API is permitted. The negative endpoint tests cover representative routes; they are not a universal proof that all future routes are safe.

## MongoDB boundary

Only these platform collections are planned:

`users`, `authSessions`, `authAttempts`, `devices`, `pairingRequests`, `helpEntries`, `communityPosts`, `communityComments`, `reports`, `auditEvents`, `platformSettings`.

Forbidden collections include `lectures`, `recordings`, `captures`, `thumbnails`, `baselines`, `ocr`, `privateNotes`, and `media`. Review the semantics of every schema: using an allowed collection name does not make private content acceptable. Forbidden platform fields include lecture IDs/titles, media paths/URLs, frame bytes, private notes/OCR, calibration, recording timelines, capture histories and recovery manifests. Public help/community title/body fields are allowed only for intentionally published platform content. No automatic transcript/media attachment is permitted.

Use an opaque ephemeral stream ID for analysis, with no durable lecture ID. Audit events concern account/admin actions and never contain content, tokens, frames or per-lecture processing history. Backups cover platform data only and must not traverse legacy recording folders.

## Transient analysis

Connected analysis is optional and requires disclosure/permission. It may process selected frames in bounded RAM. It must never save frames/results as a fallback for failed local saves. Buffers expire and clear on disconnect, expiry, logout, revocation and inactivity. The phone is authoritative for accepted baselines. [The lifecycle contract](live-protocol.md) defines acknowledgment and retry behavior.

Do not introduce multipart media parsing, body logging, disk spooling, debug images, image caches, payload tracing or memory-dump uploads. Audit proxy buffering, host swap, crash dumps and backup behavior before claiming strict physical RAM-only handling. B1 has no frame transport or analysis worker, so it cannot prove that deployment property.

## Identity and administration

Logout, token expiration and account/device blocking revoke platform access while preserving local files. Administrators manage platform data, not private phone recordings. Public signup can create USER only; no default admin credentials or automatic first-signup promotion. Native credentials use secure OS storage. Website cookies need Secure/HttpOnly/same-site and CSRF/origin checks when authentication is implemented.

## Acceptance still required

Future tests must inspect MongoDB, working/temp directories, logs, caches and backup outputs after distinctive synthetic frames succeed, fail, disconnect and crash. Real phone save/reopen with the backend stopped remains a separate physical-device acceptance gate. Passing current endpoint tests does not establish either result.
