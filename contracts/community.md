# Community GraphQL contract — version 1

Community is deliberately entered general text, separate from private lectures. V1 implements posts only: no comments, reports, reactions, search, attachments, import, lecture references, revision archive or permanent deletion. The website is the separate Pages Router project; no mobile code changes are required.

## Setup and transport

Explicit `npm run db:prepare` prepares `communityPosts` and five indexes for public publication order, owner updated-time/state lists and administrator updated-time/state lists. It preserves existing content/indexes, seeds nothing and does not run at startup. All community operations fail closed with `SERVICE_UNAVAILABLE` without required indexes. Core readiness remains limited to its existing database/authentication checks and does not certify community preparation.

Application/production preparation and deployment are separate operator work. Prepare and verify required indexes using the release's setup tooling **before updating the running backend and website**. The earlier Help rollout likewise still requires its explicit index preparation; implementation/test results do not establish application rollout.

Use `POST /graphql` with `{ "query": "<one operation>", "variables": { ... } }`. Existing limits remain: 64 KiB JSON, 8 KiB UTF-8 document, five roots, 80 AST fields, six selection levels/definitions, no HTTP batching/introspection/persisted queries. Responses are no-store. Public and protected requests share 60/IP/minute; protected requests also use 60/account/minute. Community mutations share 20 service-reached attempts/account/minute across creation, author changes and moderation; validation performed before resolver execution does not consume that write budget.

Public reads use `X-SmartBord-Client: public`, `Content-Type: application/json`, `credentials: omit`, and no Cookie, Authorization or CSRF. Supplied browser origins must exactly match configured HTTPS origins. Public mode issues no cookies/nonces and never refreshes. Its parsed allowlist permits only `helpEntries`, `helpEntry`, `communityPosts`, `communityPost`, including aliases/fragments. Mutations and protected roots, even behind directives, are rejected before execution.

Protected operations require a current ACTIVE account with the existing browser cookie/CSRF or native bearer transport. See [authentication](authentication.md). Administrators must currently have ADMIN role. Mutations reacquire the shared policy lock and reauthenticate inside their MongoDB transaction, so account blocking/demotion cannot authorize later writes from stale credentials.

## Operations and Variables

Public operations require no identity. The public summary type exposes only `id`, `title`, `publicDisplayName`, `publishedAt`, `updatedAt`; detail additionally exposes `bodyMarkdown`. It exposes no account email/ID, revision, draft state or moderation metadata.

```graphql
query CommunityPosts($input: CommunityPostsInput!) {
  communityPosts(input: $input) {
    items { id title publicDisplayName publishedAt updatedAt }
    page pageSize total
  }
}
query CommunityPost($id: ID!) {
  communityPost(id: $id) {
    id title publicDisplayName bodyMarkdown publishedAt updatedAt
  }
}
```

List Variables: `{"input":{"page":1,"pageSize":20}}`. Detail Variables: `{"id":"<published fixture UUID>"}`. Only PUBLISHED posts are visible. Draft, removed and missing valid UUIDs all yield `NOT_FOUND`; malformed UUIDs yield `VALIDATION_ERROR`. Public ordering is publication time descending, then UUID ascending. Live edits preserve publication time; republishing sets it anew. Blocking/deleting the author's account does not automatically hide published text: moderation is a separate action.

The managed post type exposes `id`, `authorUserId`, `title`, `publicDisplayName`, `bodyMarkdown`, `state`, `revision`, `createdAt`, `updatedAt`, nullable `publishedAt`, `removedAt`, `removalReason`. It does not expose moderator account IDs. All timestamps are ISO UTC strings.

```graphql
query MyCommunityPosts($input: ManagedCommunityPostsInput!) {
  myCommunityPosts(input: $input) {
    items { id title publicDisplayName state revision updatedAt removalReason }
    page pageSize total
  }
}
query MyCommunityPost($id: ID!) {
  myCommunityPost(id: $id) {
    id title publicDisplayName bodyMarkdown state revision removalReason
  }
}
mutation CreateCommunityPost($input: CreateCommunityPostInput!) {
  createCommunityPost(input: $input) { id state revision }
}
mutation UpdateCommunityPost($input: UpdateCommunityPostInput!) {
  updateCommunityPost(input: $input) { id state revision }
}
```

Owner list Variables: `{"input":{"page":1,"pageSize":20,"state":"DRAFT"}}`; omit state for all owned states. Owner detail uses `{"id":"<owned fixture UUID>"}`. Only the current owner's records are available; another owner's ID yields `NOT_FOUND`, including when the caller is an administrator using owner operations.

Create Variables: `{"input":{"title":"Disposable idea","publicDisplayName":"Chosen community name","bodyMarkdown":"## Idea\n\nGeneral community text."}}`. Creation always assigns the current owner, DRAFT and revision 1 server-side. Titles/public names are trimmed, nonblank and limited to 160/80 characters. Markdown is nonblank and limited to 16384 UTF-8 bytes, with whitespace otherwise preserved. C0 controls except tab/newline/carriage return and DEL are rejected in text. Unknown fields, explicit nulls and invalid IDs/enums/bounds are rejected. Lists use `{ items, page, pageSize, total }`, default page 1/pageSize 20, page 1–10000 and pageSize 1–100. Managed lists order by updated time descending and UUID ascending.

Update Variables require `id`, `expectedRevision` and at least one editable field:

- Edit: `{"input":{"id":"<owned fixture UUID>","expectedRevision":1,"title":"Revised idea"}}`.
- Publish: `{"input":{"id":"<owned fixture UUID>","expectedRevision":2,"state":"PUBLISHED"}}`.
- Withdraw: current revision and `state: "DRAFT"`.
- Other editable fields: `bodyMarkdown`, `publicDisplayName`. Published edits immediately affect subsequent reader requests and require website confirmation.

Unchanged author submissions retain their revision and generate no audit event. Stale revisions, author attempts to set REMOVED, and author changes to a removed post yield `CONFLICT`. Removed posts remain readable by their owner with the coded reason.

Administrator operations require a current ACTIVE ADMIN; USER yields `FORBIDDEN`, and missing/revoked credentials yield `UNAUTHENTICATED`.

```graphql
query AdminCommunityPosts($input: ManagedCommunityPostsInput!) {
  adminCommunityPosts(input: $input) {
    items { id authorUserId title publicDisplayName state revision updatedAt removalReason }
    page pageSize total
  }
}
query AdminCommunityPost($id: ID!) {
  adminCommunityPost(id: $id) {
    id authorUserId title publicDisplayName bodyMarkdown state revision removalReason
  }
}
mutation AdminModerateCommunityPost($input: ModerateCommunityPostInput!) {
  adminModerateCommunityPost(input: $input) { id state revision removalReason }
}
```

Admin list Variables use the same pagination/optional state shape; detail uses the post UUID. Draft text is deliberately saved community content and is accessible to administrators, as disclosed before saving. Administrators cannot alter another author's text or publish it. They can use normal owner operations for their own posts.

Remove Variables: `{"input":{"id":"<fixture UUID>","expectedRevision":3,"action":"REMOVE","reason":"PRIVACY"}}`. Reason is mandatory and one of SPAM, ABUSE, PRIVACY, OFF_TOPIC, OTHER. DRAFT/PUBLISHED → REMOVED excludes the post publicly and locks author changes. Restore Variables: `{"input":{"id":"<fixture UUID>","expectedRevision":4,"action":"RESTORE"}}`, omitting reason. REMOVED → DRAFT clears current removal metadata and never publishes. Invalid/repeated transitions or stale revisions yield `CONFLICT`; missing/invalid reason usage yields `VALIDATION_ERROR`.

Actual changes atomically increment revision and insert `COMMUNITY_POST_CHANGED`: actor ID/role, post subject ID, CREATE/UPDATE/REMOVE/RESTORE, previous/next state, revision, reason if removing, and time. No title/body/public name is copied into audits. Prior moderation reasons remain in metadata-only audit events; there is no content history. Audit failure rolls back the post change. Withdrawal/removal retain the server copy; V1 offers no permanent deletion or removal of copies already read by others.

## Website and privacy behavior

Public pages are `/community` and `/community/[id]`; author editing is inside `/account/posts`, and read-only content inspection/moderation is at `/admin/community`. Anonymous protected visits redirect to login. Protected SSR props contain only request-scoped account-shell information, never draft bodies or post lists. The chosen post-level public name defaults from the account name but is editable; publication confirmation displays it.

“Save draft on server” explicitly stores the entered text where administrators can read it. “Publish publicly” is separate. Live edits, withdrawal, removal and restoration require target-specific confirmation. Unsaved buffers stay in memory, survive successful same-actor checks, warn before navigation discards them, and clear on identity changes/logout/failed authorization. Conflicts require reload. Uncertain writes are never replayed automatically; read-only reconciliation closes the editor and lets the author/moderator inspect actual state. Known mutation success and failed refetch are reported separately.

Preview/readers share Help's restricted Markdown renderer: no raw HTML, images, embedded media or MDX, only safe link schemes and formatting. No URL fetch/upload/filesystem/media importer exists. Users deliberately enter general text: the server cannot identify every manually pasted transcript semantically. There is no automatic private-device reading, transcript publication, attachment or local lecture identifier. Blocking/logout never sends a phone-file command.

## Disposable verification and cleanup

Examples are wire documentation, not live saved Postman examples. Prerequisites: dedicated `MONGODB_TEST_URI`, generated exact `sbt_<32 hex digits>` database verified initially empty, prepared schemas and synthetic USER/ADMIN accounts. Publish only intentionally created synthetic text. Verify exact configured/connected identity before dropping that owned database, close its app/connections, and stop its temporary loopback host. Never prepare application records or bootstrap real administrators as test fixtures.

Backend integration covers permissions, visibility, validation, ordering, state transitions, audit rollback, indexes, budgets, races and restart. Website `yarn test:web --dev --local-cert --community` and `yarn test:web --local-cert --community` include auth/admin/Help regressions. See [progress](../docs/Development_progress.md) and [website verification](../../smartbord-ai-frontend-web/docs/Verification.md) for actual dated results. B3/F1 physical-phone capture/restart/backend-unavailable reopen proof remains incomplete.
