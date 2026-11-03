# Help center GraphQL contract — version 1

Help is intentionally published platform text, not a private lecture library. The versioned [schema](schema.graphql) adds FAQ/announcement reads and administrator management at `POST /graphql`. No upload, attachment, community operation, phone-file command, scheduled publication or content revision history is included.

## Setup and transport

An operator must explicitly run `npm run db:prepare` before using Help in the application database. It prepares `helpEntries` and five content indexes without inserting content or dropping data/indexes. Startup never prepares them automatically. Help fails with `SERVICE_UNAVAILABLE` when required indexes are missing. Health readiness still certifies only its existing core database/authentication checks. Application setup/data were not changed by this increment; automated preparation is restricted to verified disposable fixtures.

JSON bodies at `/graphql` are limited to **64 KiB**, with an **8 KiB UTF-8 operation document**. Authentication JSON stays at 8 KiB. Existing one-operation, five-root, 80-field, six-selection-level, six-definition, no-batching, no-introspection and no-persisted-query policies remain. Pages use `{ items, page, pageSize, total }`: page 1–10000, pageSize 1–100, default 20. All responses are no-store. Existing 60 GraphQL requests/IP/minute remain shared across public/protected traffic; authenticated requests also retain 60/account/minute. Help writes share 20 attempts/administrator/minute, including edits, publication and archive/restore.

Anonymous readers send `Content-Type: application/json` and **`X-SmartBord-Client: public`**, without Cookie, Authorization or CSRF headers. Browsers must use `credentials: omit`; an Origin, when supplied, must be an exactly configured HTTPS browser origin. Public reads issue no cookies/CSRF nonce and do not refresh sessions. The bounded parsed operation may contain only `helpEntries`/`helpEntry` query roots, including roots reached through aliases/fragments. Mutations, protected roots even behind directives, mixed operations and introspection fail before execution. Ordinary browser/native credentials and CSRF requirements remain unchanged for protected operations, and public mode is rejected by authentication endpoints. See [authentication](authentication.md).

## Public reads

```graphql
query HelpEntries($input: HelpEntriesInput!) {
  helpEntries(input: $input) {
    items {
      id
      kind
      title
      topic
      order
      publishedAt
      updatedAt
    }
    page
    pageSize
    total
  }
}
query HelpEntry($id: ID!) {
  helpEntry(id: $id) {
    id
    kind
    title
    topic
    order
    publishedAt
    updatedAt
    bodyMarkdown
  }
}
```

Send only one operation per request. List Variables: `{"input":{"kind":"FAQ","page":1,"pageSize":20,"topic":"GENERAL"}}`. Omit topic for all FAQs. For announcements use `{"input":{"kind":"ANNOUNCEMENT","page":1,"pageSize":20}}`, omitting topic entirely. Detail Variables: `{"id":"<published fixture UUID>"}`. Public mode requires no identity; authenticated active accounts may also use the normal protected transport.

Only PUBLISHED records are returned. Draft, archived and nonexistent valid UUIDs all produce `NOT_FOUND` for public detail. Malformed UUIDs produce `VALIDATION_ERROR`. Public list summaries omit Markdown bodies; public types expose neither author/editor IDs, state nor revision. FAQs order by display order, creation time and UUID ascending. Announcements order by display order ascending, publication time descending and UUID ascending. Public DTO projection is independent of administrator projection.

## Administrator drafts and changes

All four administrator operations require a current ACTIVE ADMIN using the [account contract's transport](platform-accounts.md). USER is `FORBIDDEN`; missing/revoked identity is `UNAUTHENTICATED`. Mutations recheck the actor inside a policy-locked MongoDB transaction shared with account access changes.

```graphql
query AdminHelpEntries($input: AdminHelpEntriesInput!) {
  adminHelpEntries(input: $input) {
    items {
      id
      kind
      title
      bodyMarkdown
      topic
      order
      state
      revision
      createdByUserId
      updatedByUserId
      createdAt
      updatedAt
      publishedAt
    }
    page
    pageSize
    total
  }
}
query AdminHelpEntry($id: ID!) {
  adminHelpEntry(id: $id) {
    id
    kind
    title
    bodyMarkdown
    topic
    order
    state
    revision
    createdByUserId
    updatedByUserId
    createdAt
    updatedAt
    publishedAt
  }
}
mutation AdminCreateHelpEntry($input: CreateHelpEntryInput!) {
  adminCreateHelpEntry(input: $input) {
    id
    state
    revision
    title
  }
}
mutation AdminUpdateHelpEntry($input: UpdateHelpEntryInput!) {
  adminUpdateHelpEntry(input: $input) {
    id
    state
    revision
    title
  }
}
```

Admin list Variables: `{"input":{"kind":"FAQ","page":1,"pageSize":20,"state":"DRAFT"}}`; omit state to include DRAFT/PUBLISHED/ARCHIVED. FAQ topic filtering is optional. Admin sorting is updated time descending, UUID ascending. Detail Variables use the entry UUID. Draft creation Variables: `{"input":{"kind":"FAQ","title":"Disposable FAQ","bodyMarkdown":"## Answer\n\nReviewed **platform** text.","topic":"GENERAL","order":0}}`. Announcements use `kind: "ANNOUNCEMENT"` and omit topic.

Creation always returns DRAFT, revision 1 and server-assigned author/editor IDs. Kind and original author cannot be changed. Titles must be nonblank and at most 160 characters. Markdown must be nonblank and at most 16384 UTF-8 bytes; C0 controls other than tab/newline/carriage return and DEL are rejected. Markdown whitespace is otherwise preserved. Order is an integer 0–1000000, default 0. FAQ topics are GENERAL, ACCOUNTS, DEVICES, LOCAL_STORAGE, PRIVACY and OTHER. A FAQ requires a topic; an announcement rejects one. Unknown fields, explicit null inputs and invalid bounds/enums are rejected.

Update Variables always include `id` and the latest `expectedRevision`, plus at least one of title, bodyMarkdown, topic, order or state:

- Publish: `{"input":{"id":"<fixture UUID>","expectedRevision":1,"state":"PUBLISHED"}}`.
- Edit live: `{"input":{"id":"<fixture UUID>","expectedRevision":2,"bodyMarkdown":"Reviewed live update."}}`.
- Unpublish: the same shape with the current revision and `state: "DRAFT"`.
- Archive: current revision and `state: "ARCHIVED"`.
- Restore: an ARCHIVED entry accepts only current revision and `state: "DRAFT"`; restore cannot edit or publish simultaneously.

Actual changes increment revision and atomically write `HELP_ENTRY_CHANGED` metadata with actor ID, help-entry subject ID, previous/next state, revision and time. Audit events contain no title/body and do not fabricate a user subject for a content record. Audit failure rolls back content changes. No-ops retain revision and create no content audit. Stale revisions return `CONFLICT`; missing targets return `NOT_FOUND`. Published edits and order/topic changes affect subsequent reader requests immediately. Publishing sets publication time; editing a published entry retains that time. Archives retain content; there is no physical deletion operation.

## Browser behavior and safe rendering

Public pages are `/help` and `/help/[id]`; protected management is `/admin/help`. Creation saves a draft. Publishing, saving live changes, unpublishing and archiving require target-specific confirmation. Restore returns to draft. Preview and public pages share a restricted Markdown renderer: CommonMark headings/lists/emphasis/quotes/code and HTTP(S), root-relative or fragment links; no raw HTML, images, embedded media or MDX. The server stores strings and never fetches URLs or renders uploads.

Editor buffers stay in memory. Successful same-actor identity revalidation preserves unsaved edits; failed validation, identity changes and logout clear protected state. Navigation warns before discarding unsaved content. Revision conflicts require reloading the entry. Uncertain writes are not automatically repeated; successful directory reconciliation closes the uncertain editor so the administrator can inspect actual state before another attempt. A successful mutation followed by failed refetch is reported separately.

## Disposable examples and verification

Examples above are expected wire shapes, not live Postman saved examples. Use only a dedicated `MONGODB_TEST_URI`, a generated exact `sbt_<32 hex digits>` database proven initially empty, and synthetic administrator/member identities. Never use application records as fixtures. Content is created/published only deliberately by test/admin actions; startup has no content seeds. Guard exact configured/connected database identity before cleanup, stop its owned listener, drop only its exact owned DB and close connections.

See [development progress](../docs/Development_progress.md) and [website verification](../../smartbord-ai-frontend-web/docs/Verification.md) for dated executed checks and limitations. Community and B3/F1 physical-phone capture/restart/backend-unavailable reopen proof remain incomplete.
