# Community comments and reports — version 1

This extends [community posts](community.md). Only deliberately entered general community text is accepted. There are no attachments, replies/threading, lecture IDs, recording importers, free-text reports, permanent deletion, reactions or automatic content removal. Private lectures remain on devices. The website uses its established separate Pages Router repository; mobile is unchanged.

## Prerequisites, transport and limits

All operations use `POST /graphql` with `{ "query": "<one operation>", "variables": { ... } }`. Use the [generated schema](schema.graphql) for exact wire types. Existing request/document/depth/field budgets, strict validation, exact origins, safe errors and no-store responses remain. No HTTP batching is accepted. Authenticated clients use the existing [browser cookies/CSRF or native bearer transport](authentication.md). Current ACTIVE accounts are required for owner/report operations; administrative operations require current ADMIN. Missing/revoked sessions yield `UNAUTHENTICATED`, wrong roles `FORBIDDEN`.

Credential-free `X-SmartBord-Client: public` allows the new `communityComments` reader alongside the four existing Help/post readers. Use `credentials: omit` with no Cookie, Authorization or CSRF header. Protected roots and mutations are rejected even behind aliases, fragments or skipped directives. Public reads do not issue credentials or refresh sessions. Shared GraphQL budgets remain 60/IP/minute and 60/account/minute for protected requests.

Explicit `npm run db:prepare` additionally prepares `communityComments` (six list/order indexes) and `reports` (four list indexes plus a unique non-sparse, non-partial reporter/type/target index). Automatic startup preparation and content seeds are disabled. Each feature fails closed with `SERVICE_UNAVAILABLE` if its indexes are missing. Comments also require prepared post indexes; submitting a comment report additionally requires prepared comment indexes. Listing/reviewing existing reports does not require target indexes. Existing core readiness does not certify these features. Setup is additive and preserves records/indexes; it never silently repairs incompatible uniqueness by deleting records.

**Prepare and verify the new indexes with release setup tooling before updating running backend/website services. Application setup and deployment are separate operator actions, not performed by implementing or testing this increment.**

Posts, comments, report submission and report review share 20 service-reached write attempts/account/minute. Report submission also uses 10 attempts/account/minute. Invalid requests rejected before the resolver do not consume these service budgets. Writes reacquire the shared policy lock and reauthenticate in the transaction, serializing against post visibility changes, moderation, account blocking and administrator demotion. Actual changes and metadata-only audits commit atomically; audit failure rolls back the write. No content/title/public-name copies enter audits.

All IDs are UUID v4 strings and timestamps are ISO UTC. List results use `{ items, page, pageSize, total }`, default page 1/pageSize 20, page 1–10000 and pageSize 1–100. Unknown properties, explicit null optional inputs, invalid enums and bounds are rejected with `VALIDATION_ERROR`.

## Public comments

```graphql
query CommunityComments($input: CommunityCommentsInput!) {
  communityComments(input: $input) {
    items { id postId publicDisplayName bodyMarkdown publishedAt updatedAt }
    page pageSize total
  }
}
```

Variables: `{"input":{"postId":"<published synthetic post UUID>","page":1,"pageSize":20}}`.

Only PUBLISHED comments under a currently PUBLISHED parent appear. Parent visibility and comment listing occur in one database aggregation, including an empty list. Draft, removed or missing valid parent IDs yield the same `NOT_FOUND`; malformed IDs yield `VALIDATION_ERROR`. Order is publication time ascending, then UUID ascending. Public comments expose no author account ID/email, revision, state, removal metadata or report data. Account blocking does not itself remove already published text; moderation remains separate.

## Owner comment operations

```graphql
query MyCommunityComments($input: ManagedCommunityCommentsInput!) {
  myCommunityComments(input: $input) {
    items { id postId publicDisplayName bodyMarkdown state revision removalReason }
    page pageSize total
  }
}
query MyCommunityComment($id: ID!) {
  myCommunityComment(id: $id) { id postId bodyMarkdown publicDisplayName state revision removalReason }
}
mutation CreateCommunityComment($input: CreateCommunityCommentInput!) {
  createCommunityComment(input: $input) { id postId state revision }
}
mutation UpdateCommunityComment($input: UpdateCommunityCommentInput!) {
  updateCommunityComment(input: $input) { id state revision removalReason }
}
```

List Variables: `{"input":{"page":1,"pageSize":20,"postId":"<parent UUID>","state":"DRAFT"}}`; omit postId/state for all owned comments. Detail Variables: `{"id":"<owned comment UUID>"}`. Managed lists order by updated time descending, then UUID ascending. Owner scope is server-derived: other owners' IDs return `NOT_FOUND`, even to an administrator using owner operations. Owners can read their own withdrawn/removed comments under a hidden parent. Managed objects additionally expose authorUserId, createdAt and nullable removedAt, but no moderator ID.

Create Variables: `{"input":{"postId":"<published parent UUID>","publicDisplayName":"Chosen public name","bodyMarkdown":"A general **community** comment."}}`. Creation **publishes immediately** at revision 1. The website requires explicit confirmation before this action. New unsaved comment text exists in memory only. The server derives author/state/time; callers cannot set them. The name is trimmed, nonblank and at most 80 characters; Markdown is nonblank and at most 4096 UTF-8 bytes, with other whitespace preserved. C0 controls except tab/newline/carriage return and DEL are rejected.

Update Variables require `id`, `expectedRevision` and at least one of publicDisplayName, bodyMarkdown, state:

- Edit: `{"input":{"id":"<owned comment UUID>","expectedRevision":1,"bodyMarkdown":"Revised general text"}}`. Live edits preserve publication time and appear publicly on subsequent reads.
- Withdraw: `{"input":{"id":"<owned comment UUID>","expectedRevision":2,"state":"DRAFT"}}`. This retains server text and hides it publicly; it does not delete other readers' copies.
- Republish: same shape with current revision and `state:"PUBLISHED"`; this sets a new publication time.

Editing/name changes and republishing require a published parent. A state-only withdrawal is allowed after a parent becomes hidden. A removed comment is locked to author writes. Authors cannot set REMOVED. Stale revisions/locked states yield `CONFLICT`; empty updates/nulls yield `VALIDATION_ERROR`. Unchanged updates retain revision/time and add no audit. Changes add `COMMUNITY_COMMENT_CHANGED` with comment ID, actor ID/role, action, before/after state, revision, optional coded removal reason and time.

## Administrator comment moderation

```graphql
query AdminCommunityComments($input: ManagedCommunityCommentsInput!) {
  adminCommunityComments(input: $input) {
    items { id postId authorUserId publicDisplayName bodyMarkdown state revision removalReason }
    page pageSize total
  }
}
query AdminCommunityComment($id: ID!) {
  adminCommunityComment(id: $id) { id postId publicDisplayName bodyMarkdown state revision removalReason }
}
mutation AdminModerateCommunityComment($input: ModerateCommunityCommentInput!) {
  adminModerateCommunityComment(input: $input) { id state revision removalReason }
}
```

List/detail Variables match owner shapes. Administrative reads include all states, including hidden parents. Remove Variables: `{"input":{"id":"<comment UUID>","expectedRevision":3,"action":"REMOVE","reason":"PRIVACY"}}`. Reason is required: SPAM, ABUSE, PRIVACY, OFF_TOPIC or OTHER. DRAFT/PUBLISHED → REMOVED locks the author and discloses the reason to them. Restore Variables: `{"input":{"id":"<removed UUID>","expectedRevision":4,"action":"RESTORE"}}`, omitting reason. REMOVED → DRAFT clears current removal metadata; restoration never publishes. Wrong transitions/stale revisions yield `CONFLICT`; incorrect reason usage yields `VALIDATION_ERROR`. Administrators cannot rewrite or republish another owner's text. No cascading comment state changes occur when a parent is hidden/restored: public parent visibility is always enforced separately.

## Reports and review

```graphql
mutation CreateCommunityReport($input: CreateCommunityReportInput!) {
  createCommunityReport(input: $input) { id targetType targetId postId reason state revision createdAt updatedAt }
}
query MyCommunityReports($input: CommunityReportsInput!) {
  myCommunityReports(input: $input) {
    items { id targetType targetId postId reason state revision createdAt updatedAt }
    page pageSize total
  }
}
query AdminCommunityReports($input: CommunityReportsInput!) {
  adminCommunityReports(input: $input) {
    items { id targetType targetId postId reason state revision createdAt updatedAt }
    page pageSize total
  }
}
mutation AdminReviewCommunityReport($input: ReviewCommunityReportInput!) {
  adminReviewCommunityReport(input: $input) { id state revision updatedAt }
}
```

Submit Variables: `{"input":{"targetType":"COMMENT","targetId":"<published comment UUID>","reason":"ABUSE"}}`; targetType may instead be POST. Only currently published targets under a published parent can be reported; hidden/missing targets yield `NOT_FOUND`. A report starts OPEN at revision 1. Reason uses the five moderation codes; there is no free-text message, screenshot/file, lecture reference or caller-supplied reporter. One report per account/type/target is retained for its lifetime, even after review; duplicate/concurrent repeat submission yields `CONFLICT`. Other accounts may independently report the same target. Authors can report their own published text. Reports do not automatically hide content.

List Variables: `{"input":{"page":1,"pageSize":20,"state":"OPEN","targetType":"COMMENT"}}`; state/type filters are optional. Ordering is updated time descending, UUID ascending. Owner results include only the caller's reports, even if the caller owns the reported post/comment. Administrative results include all reports. Neither response exposes reporter/moderator account IDs, account email or target text copies; there is no public report/count reader. Report history remains available to its reporter/admin after target withdrawal/removal.

Review Variables: `{"input":{"id":"<report UUID>","expectedRevision":1,"state":"RESOLVED"}}`, or DISMISSED. Only OPEN → RESOLVED/DISMISSED is supported. OPEN as a requested destination yields `VALIDATION_ERROR`; stale/closed review yields `CONFLICT`. Review increments revision, stores the reviewing administrator privately and adds `COMMUNITY_REPORT_CHANGED` audit metadata. Creation uses the same action with CREATE and the coded reason. Concurrent administrators cannot both review the same revision. No reopen, deletion or automatic moderation occurs. Administrators inspect the exact current post/comment through its protected detail operation, apply reasoned content moderation separately if needed, then record the report outcome. Outcome alone does not change content visibility.

## Website behavior and verification

`/community/[id]` adds credential-free paginated discussion, a protected write link and post/comment report links. `/account/comments?postId=<UUID>&compose=1` provides a confirmed composer; `/account/comments` lists owned comments. `/admin/comments` lists/moderates all states. `/account/reports?targetType=COMMENT&targetId=<UUID>` submits a coded report and shows private history; `/admin/reports` inspects current target text, performs separate content moderation and records review outcomes. Protected SSR includes account-shell information only. In-memory buffers use the existing protected lifecycle and cancelable navigation guard; logout/blocking/identity changes clear them. Safe restricted Markdown renders no HTML/images/embedded media. Conflict/ambiguous writes lock mutation controls until read-only reconciliation; writes are never automatically replayed. Known success followed by read failure is distinguished from uncertain commit.

Examples are documentation, not saved live Postman requests. Test prerequisites: dedicated `MONGODB_TEST_URI`, generated exact `sbt_<32 hex digits>` database verified initially empty, prepared schemas and synthetic USER/ADMIN accounts. Never use application data. Before dropping, verify configured and connected exact identity; close owned connections/apps/listeners afterward. Browser tests use existing trusted localhost HTTPS with no TLS bypass. `yarn test:web --dev --local-cert --discussion` and `yarn test:web --local-cert --discussion` include existing auth/admin/Help/community regressions. The test-only host has bounded 30-minute lifetime for this expanded mode (15 minutes otherwise), and private IPC may remove/restore only fixed comment/report indexes after exact fixture checks. No production fixture route exists.

See [dated backend evidence](../docs/Development_progress.md) and [website verification](../../smartbord-ai-frontend-web/docs/Verification.md) for executed checks and limitations. Native-phone storage/recording, production rollout and deployment-wide no-retention remain separate acceptance work.
