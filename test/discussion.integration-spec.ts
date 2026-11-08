import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MembersService } from '../src/modules/members/members.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';
import { CommentSchemaService } from '../src/modules/community/comment-schema.service';
import { ReportSchemaService } from '../src/modules/reports/report-schema.service';
import { CommunitySchemaService } from '../src/modules/community/community-schema.service';
import {
  configureDisposableDatabase,
  assertInitiallyEmpty,
  assertExactTestDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

const commentFields =
  'id postId authorUserId publicDisplayName bodyMarkdown state revision createdAt updatedAt publishedAt removedAt removalReason';
const reportFields =
  'id targetType targetId postId reason state revision createdAt updatedAt';
const create = `mutation($input:CreateCommunityCommentInput!){createCommunityComment(input:$input){${commentFields}}}`;
const update = `mutation($input:UpdateCommunityCommentInput!){updateCommunityComment(input:$input){${commentFields}}}`;
const moderate = `mutation($input:ModerateCommunityCommentInput!){adminModerateCommunityComment(input:$input){${commentFields}}}`;
const list =
  'query($input:CommunityCommentsInput!){communityComments(input:$input){items{id postId publicDisplayName bodyMarkdown publishedAt updatedAt}page pageSize total}}';
const own = `query($input:ManagedCommunityCommentsInput!){myCommunityComments(input:$input){items{${commentFields}}page pageSize total}}`;
const adminList = own.replace('myCommunityComments', 'adminCommunityComments');
const report = `mutation($input:CreateCommunityReportInput!){createCommunityReport(input:$input){${reportFields}}}`;
const reports = `query($input:CommunityReportsInput!){myCommunityReports(input:$input){items{${reportFields}}page pageSize total}}`;
const adminReports = reports.replace(
  'myCommunityReports',
  'adminCommunityReports',
);
const review = `mutation($input:ReviewCommunityReportInput!){adminReviewCommunityReport(input:$input){${reportFields}}}`;
const access =
  'mutation($input:UpdateAccountAccessInput!){adminUpdateAccountAccess(input:$input){id role status}}';
const password = 'Synthetic-discussion-password';
type Actor = { id: string; token: string };
type Comment = {
  id: string;
  revision: number;
  postId: string;
  state: string;
  bodyMarkdown: string;
  publicDisplayName: string;
  publishedAt: string;
};
describe('community comments and reports on owned disposable MongoDB', () => {
  let app: NestExpressApplication,
    connection: Connection,
    name: string,
    owned = false,
    admin: Actor,
    member: Actor,
    other: Actor;
  let post: { id: string; revision: number };
  const api = () => request(app.getHttpServer());
  const call = (query: string, variables: object = {}, token?: string) => {
    const req = api()
      .post('/graphql')
      .set('X-SmartBord-Client', token ? 'native' : 'public');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({ query, variables });
  };
  const code = (response: request.Response) =>
    response.body.errors?.[0]?.extensions.code ?? response.body.code;
  async function actor(role: 'ADMIN' | 'USER'): Promise<Actor> {
    const email = `discussion-${randomUUID()}@example.test`;
    const passwordHash = await app.get(PasswordService).hash(password);
    const user = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create(
          { email, name: 'Synthetic discussion actor', passwordHash },
          role,
          session,
        );
    });
    const login = await api()
      .post('/auth/login')
      .set('X-SmartBord-Client', 'native')
      .send({ email, password })
      .expect(200);
    return { id: user._id, token: login.body.accessToken as string };
  }
  async function open() {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
      logger: false,
      abortOnError: false,
    });
    connection = app.get<Connection>(getConnectionToken());
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  }
  async function make(
    extra: object = {},
    token = member.token,
  ): Promise<Comment> {
    const response = await call(
      create,
      {
        input: {
          postId: post.id,
          publicDisplayName: 'Chosen commenter',
          bodyMarkdown: 'Synthetic **discussion** text',
          ...extra,
        },
      },
      token,
    );
    expect(response.body.errors).toBeUndefined();
    return response.body.data.createCommunityComment;
  }
  async function change(entry: Comment, extra: object, token = member.token) {
    return call(
      update,
      { input: { id: entry.id, expectedRevision: entry.revision, ...extra } },
      token,
    );
  }
  async function hide(state: string) {
    const response = await call(
      'mutation($input:UpdateCommunityPostInput!){updateCommunityPost(input:$input){id revision}}',
      { input: { id: post.id, expectedRevision: post.revision, state } },
      member.token,
    );
    expect(response.body.errors).toBeUndefined();
    post = response.body.data.updateCommunityPost;
  }
  async function sendReport(
    targetId: string,
    targetType = 'COMMENT',
    token = other.token,
  ) {
    return call(
      report,
      { input: { targetId, targetType, reason: 'PRIVACY' } },
      token,
    );
  }
  async function remove(entry: Comment) {
    const response = await call(
      moderate,
      {
        input: {
          id: entry.id,
          expectedRevision: entry.revision,
          action: 'REMOVE',
          reason: 'SPAM',
        },
      },
      admin.token,
    );
    expect(response.body.errors).toBeUndefined();
    return response.body.data.adminModerateCommunityComment as Comment;
  }
  beforeAll(async () => {
    name = configureDisposableDatabase();
    await open();
    await assertInitiallyEmpty(connection, name);
    owned = true;
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(CommunitySchemaService).prepare();
    await app.get(CommentSchemaService).prepare();
    await app.get(ReportSchemaService).prepare();
    admin = await actor('ADMIN');
    member = await actor('USER');
    other = await actor('USER');
  });
  beforeEach(async () => {
    assertExactTestDatabase(connection, name);
    for (const collection of [
      'communityPosts',
      'communityComments',
      'reports',
      'auditEvents',
      'authAttempts',
    ])
      await connection.collection(collection).deleteMany({});
    const response = await call(
      'mutation($input:CreateCommunityPostInput!){createCommunityPost(input:$input){id revision}}',
      {
        input: {
          title: 'Synthetic parent',
          publicDisplayName: 'Parent alias',
          bodyMarkdown: 'General text',
        },
      },
      member.token,
    );
    post = response.body.data.createCommunityPost;
    await hide('PUBLISHED');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (owned) await dropOwnedTestDatabase(connection, name);
    } finally {
      await app?.close();
    }
  });
  it('publishes flat comments with chosen attribution and no public account/moderation fields', async () => {
    const entry = await make();
    expect(entry.state).toBe('PUBLISHED');
    const response = await call(list, { input: { postId: post.id } });
    expect(response.body.data.communityComments).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ id: entry.id, publicDisplayName: 'Chosen commenter' }],
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain(member.id);
    await call(
      'query($input:CommunityCommentsInput!){communityComments(input:$input){items{authorUserId revision removalReason}}}',
      { input: { postId: post.id } },
    ).expect(400);
    expect(
      code(
        await call(create, {
          input: {
            postId: post.id,
            publicDisplayName: 'Name',
            bodyMarkdown: 'Text',
          },
        }),
      ),
    ).toBe('UNAUTHENTICATED');
  });
  it('enforces parent visibility for empty and populated reads, creation, edits and reports', async () => {
    const entry = await make();
    await hide('DRAFT');
    for (const postId of [post.id, randomUUID()])
      expect(code(await call(list, { input: { postId } }))).toBe('NOT_FOUND');
    expect(
      code(
        await call(
          create,
          {
            input: {
              postId: post.id,
              publicDisplayName: 'Name',
              bodyMarkdown: 'Text',
            },
          },
          other.token,
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(code(await change(entry, { bodyMarkdown: 'Hidden edit' }))).toBe(
      'NOT_FOUND',
    );
    expect(code(await sendReport(entry.id))).toBe('NOT_FOUND');
    expect(code(await sendReport(post.id, 'POST'))).toBe('NOT_FOUND');
    const withdrawn = await change(entry, { state: 'DRAFT' });
    expect(withdrawn.body.data.updateCommunityComment.state).toBe('DRAFT');
    expect(
      (await call(own, { input: {} }, member.token)).body.data
        .myCommunityComments.total,
    ).toBe(1);
    await hide('PUBLISHED');
    expect(
      (await call(list, { input: { postId: post.id } })).body.data
        .communityComments.total,
    ).toBe(0);
  });
  it('enforces owner IDOR and current administrator permissions', async () => {
    const entry = await make();
    const detail = `query($id:ID!){myCommunityComment(id:$id){${commentFields}}}`;
    expect(code(await call(detail, { id: entry.id }, other.token))).toBe(
      'NOT_FOUND',
    );
    expect(
      (await call(detail, { id: entry.id }, member.token)).body.data
        .myCommunityComment.id,
    ).toBe(entry.id);
    expect(
      (
        await call(
          detail.replace('myCommunityComment', 'adminCommunityComment'),
          { id: entry.id },
          admin.token,
        )
      ).body.data.adminCommunityComment.id,
    ).toBe(entry.id);
    expect(
      (await call(own, { input: {} }, other.token)).body.data
        .myCommunityComments.total,
    ).toBe(0);
    expect(code(await change(entry, { state: 'DRAFT' }, other.token))).toBe(
      'NOT_FOUND',
    );
    expect(
      code(await change(entry, { bodyMarkdown: 'Admin rewrite' }, admin.token)),
    ).toBe('NOT_FOUND');
    expect(code(await call(adminList, { input: {} }, other.token))).toBe(
      'FORBIDDEN',
    );
    expect(
      code(
        await call(
          moderate,
          {
            input: {
              id: entry.id,
              expectedRevision: 1,
              action: 'REMOVE',
              reason: 'SPAM',
            },
          },
          other.token,
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      (await call(adminList, { input: {} }, admin.token)).body.data
        .adminCommunityComments.items[0].id,
    ).toBe(entry.id);
  });
  it('validates byte bounds, control characters, nulls and forged media/identity fields', async () => {
    const base = {
      postId: post.id,
      publicDisplayName: 'Name',
      bodyMarkdown: 'Text',
    };
    for (const extra of [
      { postId: null },
      { publicDisplayName: null },
      { bodyMarkdown: ' ' },
      { bodyMarkdown: '한'.repeat(1366) },
      { bodyMarkdown: 'bad\u0000text' },
      { publicDisplayName: 'x'.repeat(81) },
    ])
      expect(
        code(
          await call(create, { input: { ...base, ...extra } }, member.token),
        ),
      ).toBe('VALIDATION_ERROR');
    for (const extra of [
      { parentCommentId: randomUUID() },
      { authorUserId: other.id },
      { state: 'DRAFT' },
      { attachment: 'file:///private' },
    ])
      await call(create, { input: { ...base, ...extra } }, member.token).expect(
        400,
      );
    expect(
      (await make({ bodyMarkdown: '한'.repeat(1365) })).bodyMarkdown.length,
    ).toBe(1365);
    const entry = await make();
    for (const extra of [{}, { state: null }, { bodyMarkdown: null }])
      expect(code(await change(entry, extra))).toBe('VALIDATION_ERROR');
    for (const input of [
      { postId: 'bad' },
      { postId: post.id, page: 0 },
      { postId: post.id, pageSize: 101 },
      { postId: post.id, page: null },
    ])
      expect(code(await call(list, { input }))).toBe('VALIDATION_ERROR');
  });
  it('uses revisions for live edits, no-ops, withdrawal, republishing and moderation restoration', async () => {
    let entry = await make();
    expect(
      (await change(entry, { bodyMarkdown: entry.bodyMarkdown })).body.data
        .updateCommunityComment.revision,
    ).toBe(1);
    const edited = await change(entry, {
      bodyMarkdown: 'New text',
      publicDisplayName: 'New alias',
    });
    expect(edited.body.data.updateCommunityComment.publishedAt).toBe(
      entry.publishedAt,
    );
    expect(code(await change(entry, { state: 'DRAFT' }))).toBe('CONFLICT');
    entry = edited.body.data.updateCommunityComment;
    entry = (await change(entry, { state: 'DRAFT' })).body.data
      .updateCommunityComment;
    expect(code(await sendReport(entry.id))).toBe('NOT_FOUND');
    entry = (await change(entry, { state: 'PUBLISHED' })).body.data
      .updateCommunityComment;
    entry = await remove(entry);
    expect(code(await change(entry, { state: 'PUBLISHED' }))).toBe('CONFLICT');
    expect(
      (await call(own, { input: { state: 'REMOVED' } }, member.token)).body.data
        .myCommunityComments.items[0].removalReason,
    ).toBe('SPAM');
    const restored = await call(
      moderate,
      {
        input: {
          id: entry.id,
          expectedRevision: entry.revision,
          action: 'RESTORE',
        },
      },
      admin.token,
    );
    expect(restored.body.data.adminModerateCommunityComment).toMatchObject({
      state: 'DRAFT',
      removalReason: null,
    });
    expect(
      (await call(list, { input: { postId: post.id } })).body.data
        .communityComments.total,
    ).toBe(0);
  });
  it('requires valid moderation transitions and a coded removal reason', async () => {
    const entry = await make();
    for (const input of [
      { action: 'REMOVE' },
      { action: 'RESTORE', reason: 'OTHER' },
    ])
      expect(
        code(
          await call(
            moderate,
            { input: { id: entry.id, expectedRevision: 1, ...input } },
            admin.token,
          ),
        ),
      ).toBe('VALIDATION_ERROR');
    expect(
      code(
        await call(
          moderate,
          { input: { id: entry.id, expectedRevision: 1, action: 'RESTORE' } },
          admin.token,
        ),
      ),
    ).toBe('CONFLICT');
    expect(code(await change(entry, { state: 'REMOVED' }))).toBe('CONFLICT');
  });
  it('paginates deterministically and filters managed comments without cross-owner disclosure', async () => {
    const first = await make(),
      second = await make();
    await make({}, other.token);
    const page = await call(list, {
      input: { postId: post.id, page: 2, pageSize: 1 },
    });
    expect(page.body.data.communityComments).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
      items: [{ id: second.id }],
    });
    await change(first, { state: 'DRAFT' });
    expect(
      (
        await call(
          own,
          { input: { postId: post.id, state: 'DRAFT' } },
          member.token,
        )
      ).body.data.myCommunityComments.total,
    ).toBe(1);
    expect(
      (await call(adminList, { input: { state: 'PUBLISHED' } }, admin.token))
        .body.data.adminCommunityComments.total,
    ).toBe(2);
  });
  it('creates private coded reports and rejects duplicates including concurrent submissions', async () => {
    const entry = await make();
    const result = await Promise.all([
      sendReport(entry.id),
      sendReport(entry.id),
    ]);
    expect(result.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    const created = result.find((r) => r.body.data)!.body.data
      .createCommunityReport;
    expect(created).toMatchObject({
      targetType: 'COMMENT',
      targetId: entry.id,
      postId: post.id,
      state: 'OPEN',
      revision: 1,
      reason: 'PRIVACY',
    });
    expect(JSON.stringify(created)).not.toContain(other.id);
    expect(
      (await call(reports, { input: {} }, other.token)).body.data
        .myCommunityReports.total,
    ).toBe(1);
    expect(
      (await call(reports, { input: {} }, member.token)).body.data
        .myCommunityReports.total,
    ).toBe(0);
    expect(code(await call(adminReports, { input: {} }, member.token))).toBe(
      'FORBIDDEN',
    );
    await call(reports, { input: {} }).expect(401);
    await call('query{communityReports(input:{}){total}}').expect(401);
    await call(
      'query{myCommunityReports(input:{}){items{reporterUserId reviewedByUserId}}}',
      {},
      other.token,
    ).expect(400);
    expect(
      (await sendReport(post.id, 'POST')).body.data.createCommunityReport
        .targetId,
    ).toBe(post.id);
  });
  it('rejects forged report fields and unpublished or missing targets', async () => {
    const input = { targetId: post.id, targetType: 'POST', reason: 'OTHER' };
    for (const extra of [
      { reporterUserId: member.id },
      { state: 'RESOLVED' },
      { notes: 'Private notes' },
      { attachment: 'file:///private' },
    ])
      await call(report, { input: { ...input, ...extra } }, other.token).expect(
        400,
      );
    for (const extra of [
      { targetId: 'bad' },
      { reason: null },
      { targetType: 'LECTURE' },
    ])
      expect(
        code(
          await call(report, { input: { ...input, ...extra } }, other.token),
        ),
      ).toBe('VALIDATION_ERROR');
    expect(code(await sendReport(randomUUID()))).toBe('NOT_FOUND');
    const removed = await remove(await make());
    expect(code(await sendReport(removed.id))).toBe('NOT_FOUND');
  });
  it('reviews reports with revision conflicts and no implicit content removal', async () => {
    const entry = await make();
    const created = (await sendReport(entry.id)).body.data
      .createCommunityReport;
    expect(
      code(
        await call(
          review,
          { input: { id: created.id, expectedRevision: 1, state: 'OPEN' } },
          admin.token,
        ),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(
      code(
        await call(
          review,
          { input: { id: created.id, expectedRevision: 1, state: 'RESOLVED' } },
          member.token,
        ),
      ),
    ).toBe('FORBIDDEN');
    const responses = await Promise.all(
      ['RESOLVED', 'DISMISSED'].map((state) =>
        call(
          review,
          { input: { id: created.id, expectedRevision: 1, state } },
          admin.token,
        ),
      ),
    );
    expect(responses.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    expect(
      (await call(list, { input: { postId: post.id } })).body.data
        .communityComments.total,
    ).toBe(1);
    expect(
      (await call(reports, { input: {} }, other.token)).body.data
        .myCommunityReports.items[0].revision,
    ).toBe(2);
    expect(code(await sendReport(entry.id))).toBe('CONFLICT');
    expect(
      (
        await call(
          adminReports,
          { input: { state: 'OPEN', targetType: 'COMMENT' } },
          admin.token,
        )
      ).body.data.adminCommunityReports.total,
    ).toBe(0);
  });
  it('serializes concurrent moderation/author changes and hidden-parent publication races', async () => {
    const entry = await make();
    const responses = await Promise.all([
      change(entry, { bodyMarkdown: 'Racing text' }),
      call(
        moderate,
        {
          input: {
            id: entry.id,
            expectedRevision: 1,
            action: 'REMOVE',
            reason: 'OTHER',
          },
        },
        admin.token,
      ),
    ]);
    expect(responses.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    const [created] = await Promise.all([
      call(
        create,
        {
          input: {
            postId: post.id,
            publicDisplayName: 'Alias',
            bodyMarkdown: 'Race',
          },
        },
        other.token,
      ),
      hide('DRAFT'),
    ]);
    expect(created.body.data || code(created) === 'NOT_FOUND').toBeTruthy();
    expect(code(await call(list, { input: { postId: post.id } }))).toBe(
      'NOT_FOUND',
    );
  });
  it('rolls back comments, reports and reviews when audit persistence fails, with content-free audit', async () => {
    const entry = await make();
    const createdReport = (await sendReport(entry.id)).body.data
      .createCommunityReport;
    for (const [query, input, token] of [
      [
        create,
        {
          postId: post.id,
          publicDisplayName: 'Alias',
          bodyMarkdown: 'Rollback',
        },
        member.token,
      ],
      [
        update,
        { id: entry.id, expectedRevision: 1, bodyMarkdown: 'Rollback' },
        member.token,
      ],
      [
        moderate,
        {
          id: entry.id,
          expectedRevision: 1,
          action: 'REMOVE',
          reason: 'ABUSE',
        },
        admin.token,
      ],
      [
        report,
        { targetId: post.id, targetType: 'POST', reason: 'OTHER' },
        other.token,
      ],
      [
        review,
        { id: createdReport.id, expectedRevision: 1, state: 'RESOLVED' },
        admin.token,
      ],
    ] as const) {
      jest
        .spyOn(app.get(AuditService), 'discussionChanged')
        .mockRejectedValueOnce(new Error('Synthetic audit failure'));
      expect(code(await call(query, { input }, token))).toBe('INTERNAL_ERROR');
    }
    expect(
      await connection.collection('communityComments').countDocuments(),
    ).toBe(1);
    expect(
      await connection.collection('reports').countDocuments({ state: 'OPEN' }),
    ).toBe(1);
    const events = await connection
      .collection('auditEvents')
      .find({
        action: {
          $in: ['COMMUNITY_COMMENT_CHANGED', 'COMMUNITY_REPORT_CHANGED'],
        },
      })
      .toArray();
    expect(events).toHaveLength(2);
    for (const value of [
      entry.bodyMarkdown,
      entry.publicDisplayName,
      'Rollback',
    ])
      expect(JSON.stringify(events)).not.toContain(value);
  });
  it('fails closed without comment/report indexes and explicitly restores them without losing records', async () => {
    await make();
    await sendReport(post.id, 'POST');
    await connection
      .collection('communityComments')
      .dropIndex('postId_1_state_1_publishedAt_1__id_1');
    try {
      expect(code(await call(list, { input: { postId: post.id } }))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(CommentSchemaService).prepare();
    }
    await connection
      .collection('reports')
      .dropIndex('reporterUserId_1_targetType_1_targetId_1');
    try {
      expect(code(await call(reports, { input: {} }, other.token))).toBe(
        'SERVICE_UNAVAILABLE',
      );
      expect(code(await sendReport(post.id, 'POST'))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(ReportSchemaService).prepare();
    }
    expect(
      (await call(list, { input: { postId: post.id } })).body.data
        .communityComments.total,
    ).toBe(1);
    expect(
      (await call(reports, { input: {} }, other.token)).body.data
        .myCommunityReports.total,
    ).toBe(1);
  });
  it('rejects partial uniqueness that would leave closed reports outside the lifetime constraint', async () => {
    const uniqueName = 'reporterUserId_1_targetType_1_targetId_1';
    const collection = connection.collection('reports');
    await collection.dropIndex(uniqueName);
    await collection.createIndex(
      { reporterUserId: 1, targetType: 1, targetId: 1 },
      { unique: true, partialFilterExpression: { state: 'OPEN' } },
    );
    try {
      expect(code(await call(reports, { input: {} }, other.token))).toBe(
        'SERVICE_UNAVAILABLE',
      );
      expect(code(await sendReport(post.id, 'POST'))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await collection.dropIndex(uniqueName);
      await app.get(ReportSchemaService).prepare();
    }
  });
  it('applies the shared content write budget and separate report budget', async () => {
    // Keep all assertions in one deterministic rate-limit bucket.
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Math.floor(Date.now() / 60000) * 60000 + 1000);
    const entry = await make();
    await app
      .get(AuthRateLimitService)
      .consume('community:write:account', member.id, 20, 17);
    expect(code(await change(entry, { state: 'DRAFT' }))).toBe('RATE_LIMITED');
    expect(code(await sendReport(post.id, 'POST', member.token))).toBe(
      'RATE_LIMITED',
    );
    await app
      .get(AuthRateLimitService)
      .consume('community:report:account', other.id, 10, 10);
    expect(code(await sendReport(post.id, 'POST'))).toBe('RATE_LIMITED');
  });
  it('rechecks blocked actors and demoted administrators under concurrent writes', async () => {
    const writer = await actor('USER'),
      moderator = await actor('ADMIN');
    const entry = await make();
    const [submitted, blocked] = await Promise.all([
      sendReport(entry.id, 'COMMENT', writer.token),
      call(
        access,
        { input: { id: writer.id, status: 'BLOCKED' } },
        admin.token,
      ),
    ]);
    expect(blocked.body.data.adminUpdateAccountAccess.status).toBe('BLOCKED');
    expect(
      submitted.body.data || code(submitted) === 'UNAUTHENTICATED',
    ).toBeTruthy();
    await call(reports, { input: {} }, writer.token).expect(401);
    const created = (await sendReport(post.id, 'POST')).body.data
      .createCommunityReport;
    const [reviewed, demoted] = await Promise.all([
      call(
        review,
        { input: { id: created.id, expectedRevision: 1, state: 'DISMISSED' } },
        moderator.token,
      ),
      call(access, { input: { id: moderator.id, role: 'USER' } }, admin.token),
    ]);
    expect(demoted.body.data.adminUpdateAccountAccess.role).toBe('USER');
    expect(
      reviewed.body.data ||
        ['UNAUTHENTICATED', 'FORBIDDEN'].includes(code(reviewed)),
    ).toBeTruthy();
  });
  it('keeps private roots protected behind fragments/directives and public transport credential-free', async () => {
    for (const query of [
      '{...R}fragment R on Query{myCommunityReports(input:{}){total}}',
      '{communityComments(input:{postId:"' +
        post.id +
        '"}){total}adminCommunityComments(input:{}) @skip(if:true){total}}',
    ])
      await call(query).expect(401);
    for (const [key, value] of [
      ['Cookie', 'unrelated=value'],
      ['Authorization', 'Bearer invalid'],
      ['Origin', 'https://unapproved.example'],
      ['X-CSRF-Token', 'nonce'],
    ])
      await api()
        .post('/graphql')
        .set('X-SmartBord-Client', 'public')
        .set(key, value)
        .send({ query: list, variables: { input: { postId: post.id } } })
        .expect(403);
    expect(
      (
        await call(
          '{...R}fragment R on Query{x:communityComments(input:{postId:"' +
            post.id +
            '"}){total}}',
        )
      ).body.data.x.total,
    ).toBe(0);
  });
  it('preserves comments, withdrawal/removal and report outcomes across a real backend restart', async () => {
    const published = await make(),
      withdrawn = await make(),
      removed = await remove(await make());
    await change(withdrawn, { state: 'DRAFT' });
    const created = (await sendReport(published.id)).body.data
      .createCommunityReport;
    await call(
      review,
      { input: { id: created.id, expectedRevision: 1, state: 'RESOLVED' } },
      admin.token,
    );
    await app.close();
    await open();
    assertExactTestDatabase(connection, name);
    expect(
      (
        await call(list, { input: { postId: post.id } })
      ).body.data.communityComments.items.map((c: Comment) => c.id),
    ).toEqual([published.id]);
    expect(
      (await call(own, { input: { state: 'REMOVED' } }, member.token)).body.data
        .myCommunityComments.items[0].id,
    ).toBe(removed.id);
    expect(
      (await call(reports, { input: {} }, other.token)).body.data
        .myCommunityReports.items[0].state,
    ).toBe('RESOLVED');
  });
});
