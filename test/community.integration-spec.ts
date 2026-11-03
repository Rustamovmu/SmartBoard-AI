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
import { CommunitySchemaService } from '../src/modules/community/community-schema.service';
import {
  configureDisposableDatabase,
  assertInitiallyEmpty,
  assertExactTestDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

const detail =
  'query($id:ID!){communityPost(id:$id){id title publicDisplayName bodyMarkdown publishedAt updatedAt}}';
const list =
  'query($input:CommunityPostsInput!){communityPosts(input:$input){items{id title publicDisplayName publishedAt}page pageSize total}}';
const fields =
  'id title publicDisplayName bodyMarkdown state revision authorUserId createdAt updatedAt publishedAt removedAt removalReason';
const create = `mutation($input:CreateCommunityPostInput!){createCommunityPost(input:$input){${fields}}}`;
const update = `mutation($input:UpdateCommunityPostInput!){updateCommunityPost(input:$input){${fields}}}`;
const moderate = `mutation($input:ModerateCommunityPostInput!){adminModerateCommunityPost(input:$input){${fields}}}`;
const own = `query($id:ID!){myCommunityPost(id:$id){${fields}}}`;
const managed = `query($input:ManagedCommunityPostsInput!){myCommunityPosts(input:$input){items{${fields}}page pageSize total}}`;
const adminList = `query($input:ManagedCommunityPostsInput!){adminCommunityPosts(input:$input){items{${fields}}total}}`;
const access =
  'mutation($input:UpdateAccountAccessInput!){adminUpdateAccountAccess(input:$input){id role status}}';
const password = 'Synthetic-help-integration-password';
type Entry = {
  id: string;
  revision: number;
  state: string;
  title: string;
  publishedAt: string | null;
  authorUserId: string;
  bodyMarkdown: string;
  publicDisplayName: string;
  removalReason: string | null;
};
type Actor = { id: string; token: string };
describe('community posts on guarded disposable MongoDB', () => {
  let app: NestExpressApplication,
    connection: Connection,
    name: string,
    owned = false,
    admin: Actor,
    other: Actor,
    member: Actor;
  const api = () => request(app.getHttpServer());
  const call = (query: string, variables: object = {}, token?: string) => {
    const req = api()
      .post('/graphql')
      .set('X-SmartBord-Client', token ? 'native' : 'public');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({ query, variables });
  };
  const code = (response: request.Response) =>
    response.body.errors?.[0]?.extensions.code;
  async function actor(role: 'ADMIN' | 'USER'): Promise<Actor> {
    const email = `help-${randomUUID()}@example.test`;
    const passwordHash = await app.get(PasswordService).hash(password);
    const user = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create(
          { email, name: 'Synthetic help actor', passwordHash },
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
  async function make(extra: object = {}): Promise<Entry> {
    const response = await call(
      create,
      {
        input: {
          publicDisplayName: 'Chosen name',
          title: 'Synthetic question',
          bodyMarkdown: 'A **safe** answer.',
          ...extra,
        },
      },
      member.token,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.createCommunityPost as Entry;
  }
  async function change(
    entry: Entry,
    extra: object = {},
    token = member.token,
  ): Promise<Entry> {
    const response = await call(
      update,
      { input: { id: entry.id, expectedRevision: entry.revision, ...extra } },
      token,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.updateCommunityPost as Entry;
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
  beforeAll(async () => {
    name = configureDisposableDatabase();
    await open();
    await assertInitiallyEmpty(connection, name);
    owned = true;
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(CommunitySchemaService).prepare();
    admin = await actor('ADMIN');
    other = await actor('ADMIN');
    member = await actor('USER');
  });
  beforeEach(async () => {
    assertExactTestDatabase(connection, name);
    for (const collection of ['communityPosts', 'auditEvents', 'authAttempts'])
      await connection.collection(collection).deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (owned) await dropOwnedTestDatabase(connection, name);
    } finally {
      await app?.close();
    }
  });
  async function moderation(entry: Entry, action: string, reason?: string) {
    const response = await call(
      moderate,
      {
        input: {
          id: entry.id,
          expectedRevision: entry.revision,
          action,
          ...(reason ? { reason } : {}),
        },
      },
      admin.token,
    );
    expect(response.body.errors).toBeUndefined();
    return response.body.data.adminModerateCommunityPost as Entry;
  }
  it('creates owner-bound drafts and exposes only published public projections', async () => {
    let entry = await make();
    expect(entry).toMatchObject({
      state: 'DRAFT',
      revision: 1,
      authorUserId: member.id,
    });
    for (const id of [entry.id, randomUUID()])
      expect(code(await call(detail, { id }))).toBe('NOT_FOUND');
    expect(
      (await call(list, { input: {} })).body.data.communityPosts.total,
    ).toBe(0);
    entry = await change(entry, { state: 'PUBLISHED' });
    const response = await call(detail, { id: entry.id });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.communityPost.publicDisplayName).toBe(
      'Chosen name',
    );
    expect(JSON.stringify(response.body)).not.toContain(member.id);
    await call('query($id:ID!){communityPost(id:$id){authorUserId revision}}', {
      id: entry.id,
    }).expect(400);
    await call('query{communityPosts(input:{}){items{bodyMarkdown}}}').expect(
      400,
    );
  });
  it('enforces owner IDOR, anonymous rejection and administrator-only moderation', async () => {
    const entry = await make();
    expect(code(await call(own, { id: entry.id }, other.token))).toBe(
      'NOT_FOUND',
    );
    expect(
      (await call(managed, { input: {} }, other.token)).body.data
        .myCommunityPosts.total,
    ).toBe(0);
    expect(
      code(
        await call(
          update,
          { input: { id: entry.id, expectedRevision: 1, title: 'Forged' } },
          admin.token,
        ),
      ),
    ).toBe('NOT_FOUND');
    expect(code(await call(adminList, { input: {} }, member.token))).toBe(
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
          member.token,
        ),
      ),
    ).toBe('FORBIDDEN');
    await call(own, { id: entry.id }).expect(401);
    await call(create, {
      input: { title: 'X', publicDisplayName: 'Y', bodyMarkdown: 'Z' },
    }).expect(401);
    expect(
      (await call(adminList, { input: {} }, admin.token)).body.data
        .adminCommunityPosts.items[0].bodyMarkdown,
    ).toBe(entry.bodyMarkdown);
  });
  it('rejects forged fields, null inputs, unknown enums and invalid bounds', async () => {
    const base = { title: 'X', publicDisplayName: 'Y', bodyMarkdown: 'Z' };
    for (const extra of [
      { authorUserId: admin.id },
      { state: 'PUBLISHED' },
      { lectureId: randomUUID() },
      { attachment: 'file:///private' },
    ])
      await call(create, { input: { ...base, ...extra } }, member.token).expect(
        400,
      );
    for (const extra of [
      { title: ' ' },
      { title: 'x'.repeat(161) },
      { publicDisplayName: '' },
      { publicDisplayName: 'x'.repeat(81) },
      { bodyMarkdown: ' ' },
      { bodyMarkdown: '한'.repeat(6000) },
      { bodyMarkdown: 'bad\u0000text' },
      { publicDisplayName: null },
    ])
      expect(
        code(
          await call(create, { input: { ...base, ...extra } }, member.token),
        ),
      ).toBe('VALIDATION_ERROR');
    for (const input of [
      { page: 0 },
      { pageSize: 101 },
      { page: 10001 },
      { page: null },
    ])
      expect(code(await call(list, { input }))).toBe('VALIDATION_ERROR');
    expect(code(await call(detail, { id: 'invalid' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      (await make({ bodyMarkdown: '한'.repeat(5000) })).bodyMarkdown.length,
    ).toBe(5000);
  });
  it('permits live editing, withdrawal and republishing with correct publication times', async () => {
    let entry = await change(await make(), { state: 'PUBLISHED' });
    const first = entry.publishedAt;
    entry = await change(entry, {
      title: 'Live title',
      publicDisplayName: 'Chosen alias',
    });
    expect(entry.publishedAt).toBe(first);
    expect(
      (await call(detail, { id: entry.id })).body.data.communityPost.title,
    ).toBe('Live title');
    entry = await change(entry, { state: 'DRAFT' });
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    entry = await change(entry, { state: 'PUBLISHED' });
    expect(Date.parse(entry.publishedAt!)).toBeGreaterThan(Date.parse(first!));
  });
  it('removes and locks posts, discloses reasons to owners, and restores only to draft', async () => {
    let entry = await change(await make(), { state: 'PUBLISHED' });
    entry = await moderation(entry, 'REMOVE', 'PRIVACY');
    expect(entry).toMatchObject({ state: 'REMOVED', removalReason: 'PRIVACY' });
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    expect(
      (await call(own, { id: entry.id }, member.token)).body.data
        .myCommunityPost.removalReason,
    ).toBe('PRIVACY');
    for (const extra of [
      { title: 'Bypass' },
      { state: 'PUBLISHED' },
      { state: 'DRAFT' },
    ])
      expect(
        code(
          await call(
            update,
            {
              input: {
                id: entry.id,
                expectedRevision: entry.revision,
                ...extra,
              },
            },
            member.token,
          ),
        ),
      ).toBe('CONFLICT');
    entry = await moderation(entry, 'RESTORE');
    expect(entry).toMatchObject({ state: 'DRAFT', removalReason: null });
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    entry = await change(entry, { state: 'PUBLISHED' });
    expect(
      (await call(detail, { id: entry.id })).body.data.communityPost.id,
    ).toBe(entry.id);
  });
  it('rejects invalid moderation transitions and requires a removal reason', async () => {
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
    expect(
      code(
        await call(
          update,
          { input: { id: entry.id, expectedRevision: 1, state: 'REMOVED' } },
          member.token,
        ),
      ),
    ).toBe('CONFLICT');
    await call(
      moderate,
      {
        input: {
          id: entry.id,
          expectedRevision: 1,
          action: 'REMOVE',
          reason: 'SPAM',
          title: 'Admin rewrite',
        },
      },
      admin.token,
    ).expect(400);
    const removed = await moderation(entry, 'REMOVE', 'OTHER');
    expect(
      code(
        await call(
          moderate,
          {
            input: {
              id: entry.id,
              expectedRevision: removed.revision,
              action: 'REMOVE',
              reason: 'OTHER',
            },
          },
          admin.token,
        ),
      ),
    ).toBe('CONFLICT');
  });
  it('keeps no-ops unchanged and requires fresh revisions and nonempty updates', async () => {
    const entry = await make();
    expect((await change(entry, { title: entry.title })).revision).toBe(1);
    expect(
      await connection
        .collection('auditEvents')
        .countDocuments({ action: 'COMMUNITY_POST_CHANGED' }),
    ).toBe(1);
    await change(entry, { title: 'New title' });
    expect(
      code(
        await call(
          update,
          { input: { id: entry.id, expectedRevision: 1, title: 'Stale' } },
          member.token,
        ),
      ),
    ).toBe('CONFLICT');
    for (const extra of [{}, { title: null }, { state: null }])
      expect(
        code(
          await call(
            update,
            { input: { id: entry.id, expectedRevision: 2, ...extra } },
            member.token,
          ),
        ),
      ).toBe('VALIDATION_ERROR');
  });
  it('paginates public and owner/admin state-filtered lists with deterministic ties', async () => {
    const first = await change(await make({ title: 'First' }), {
      state: 'PUBLISHED',
    });
    const second = await change(await make({ title: 'Second' }), {
      state: 'PUBLISHED',
    });
    await make({ title: 'Draft' });
    expect(
      (await call(list, { input: { page: 2, pageSize: 1 } })).body.data
        .communityPosts,
    ).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      items: [{ id: first.id }],
    });
    expect(
      (await call(list, { input: {} })).body.data.communityPosts.items[0].id,
    ).toBe(second.id);
    expect(
      (await call(managed, { input: { state: 'DRAFT' } }, member.token)).body
        .data.myCommunityPosts.total,
    ).toBe(1);
    expect(
      (await call(adminList, { input: { state: 'PUBLISHED' } }, admin.token))
        .body.data.adminCommunityPosts.total,
    ).toBe(2);
    await connection
      .collection('communityPosts')
      .updateMany(
        { state: 'PUBLISHED' },
        { $set: { publishedAt: new Date(0) } },
      );
    expect(
      (await call(list, { input: {} })).body.data.communityPosts.items.map(
        (x: Entry) => x.id,
      ),
    ).toEqual([first.id, second.id].sort());
  });
  it('serializes racing author/moderator writes and records content-free audit metadata', async () => {
    const entry = await make();
    const responses = await Promise.all([
      call(
        update,
        {
          input: { id: entry.id, expectedRevision: 1, title: 'Racing author' },
        },
        member.token,
      ),
      call(
        moderate,
        {
          input: {
            id: entry.id,
            expectedRevision: 1,
            action: 'REMOVE',
            reason: 'ABUSE',
          },
        },
        admin.token,
      ),
    ]);
    expect(responses.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    expect(responses.filter((r) => r.body.data)).toHaveLength(1);
    const events = await connection
      .collection('auditEvents')
      .find({ action: 'COMMUNITY_POST_CHANGED' })
      .toArray();
    expect(events).toHaveLength(2);
    expect(events[0].subjectCommunityPostId).toBe(entry.id);
    expect(events[0].subjectUserId).toBeUndefined();
    for (const value of [
      entry.title,
      entry.bodyMarkdown,
      entry.publicDisplayName,
    ])
      expect(JSON.stringify(events)).not.toContain(value);
  });
  it('rolls back creation, editing and moderation when audit fails', async () => {
    jest
      .spyOn(app.get(AuditService), 'communityChanged')
      .mockRejectedValueOnce(new Error('Synthetic audit failure'));
    const response = await call(
      create,
      { input: { title: 'X', publicDisplayName: 'Y', bodyMarkdown: 'Z' } },
      member.token,
    );
    expect(code(response)).toBe('INTERNAL_ERROR');
    expect(await connection.collection('communityPosts').countDocuments()).toBe(
      0,
    );
    const entry = await make();
    for (const [query, input, token] of [
      [
        update,
        { id: entry.id, expectedRevision: 1, state: 'PUBLISHED' },
        member.token,
      ],
      [
        moderate,
        { id: entry.id, expectedRevision: 1, action: 'REMOVE', reason: 'SPAM' },
        admin.token,
      ],
    ] as const) {
      jest
        .spyOn(app.get(AuditService), 'communityChanged')
        .mockRejectedValueOnce(new Error('Synthetic audit failure'));
      expect(code(await call(query, { input }, token))).toBe('INTERNAL_ERROR');
      expect(
        (
          await connection
            .collection('communityPosts')
            .findOne({ _id: entry.id } as never)
        )?.state,
      ).toBe('DRAFT');
    }
  });
  it('fails closed without indexes and preserves content during explicit re-preparation', async () => {
    const entry = await make();
    await connection
      .collection('communityPosts')
      .dropIndex('state_1_publishedAt_-1__id_1');
    try {
      expect(code(await call(list, { input: {} }))).toBe('SERVICE_UNAVAILABLE');
      expect(code(await call(own, { id: entry.id }, member.token))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(CommunitySchemaService).prepare();
    }
    expect(
      (await call(own, { id: entry.id }, member.token)).body.data
        .myCommunityPost.revision,
    ).toBe(1);
  });
  it('shares the write budget across author creation, updates and moderator actions', async () => {
    if (Date.now() % 60000 > 58000)
      await new Promise((resolve) => setTimeout(resolve, 2100));
    const response = await call(
      create,
      {
        input: {
          title: 'Admin post',
          publicDisplayName: 'Admin alias',
          bodyMarkdown: 'Text',
        },
      },
      admin.token,
    );
    const entry = response.body.data.createCommunityPost;
    await app
      .get(AuthRateLimitService)
      .consume('community:write:account', admin.id, 20, 19);
    for (const [query, input] of [
      [create, { title: 'X', publicDisplayName: 'Y', bodyMarkdown: 'Z' }],
      [update, { id: entry.id, expectedRevision: 1, title: 'X' }],
      [
        moderate,
        { id: entry.id, expectedRevision: 1, action: 'REMOVE', reason: 'SPAM' },
      ],
    ] as const)
      expect(code(await call(query, { input }, admin.token))).toBe(
        'RATE_LIMITED',
      );
  });
  it('rechecks authors against concurrent account blocking and keeps published posts visible', async () => {
    const author = await actor('USER');
    const response = await call(
      create,
      {
        input: {
          title: 'Blocking race',
          publicDisplayName: 'Public alias',
          bodyMarkdown: 'Text',
        },
      },
      author.token,
    );
    const entry = await change(
      response.body.data.createCommunityPost,
      { state: 'PUBLISHED' },
      author.token,
    );
    const [saved, blocked] = await Promise.all([
      call(
        update,
        {
          input: {
            id: entry.id,
            expectedRevision: entry.revision,
            title: 'Concurrent update',
          },
        },
        author.token,
      ),
      call(
        access,
        { input: { id: author.id, status: 'BLOCKED' } },
        admin.token,
      ),
    ]);
    expect(blocked.body.data.adminUpdateAccountAccess.status).toBe('BLOCKED');
    expect(saved.body.data || code(saved) === 'UNAUTHENTICATED').toBeTruthy();
    await call(own, { id: entry.id }, author.token).expect(401);
    expect(
      (await call(detail, { id: entry.id })).body.data.communityPost.id,
    ).toBe(entry.id);
  });
  it('rechecks administrator role when moderation races demotion', async () => {
    const moderator = await actor('ADMIN');
    const entry = await make();
    const [removed, demoted] = await Promise.all([
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
        moderator.token,
      ),
      call(access, { input: { id: moderator.id, role: 'USER' } }, admin.token),
    ]);
    expect(demoted.body.data.adminUpdateAccountAccess.role).toBe('USER');
    expect(
      removed.body.data ||
        ['UNAUTHENTICATED', 'FORBIDDEN'].includes(code(removed)),
    ).toBeTruthy();
    await call(adminList, { input: {} }, moderator.token).expect(401);
  });
  it('enforces public operation allowlists and credential/origin rejection for community', async () => {
    for (const query of [
      '{alias:myCommunityPosts(input:{}){total}}',
      '{...R}fragment R on Query{adminCommunityPosts(input:{}){total}}',
      '{communityPosts(input:{}){total}myCommunityPosts(input:{}) @skip(if:true){total}}',
      'mutation{createCommunityPost(input:{title:"X",publicDisplayName:"Y",bodyMarkdown:"Z"}){id}}',
    ])
      await call(query).expect(401);
    for (const [header, value] of [
      ['Cookie', 'unrelated=value'],
      ['Authorization', 'Bearer invalid'],
      ['Origin', 'https://unapproved.example'],
      ['X-CSRF-Token', 'nonce'],
    ])
      await api()
        .post('/graphql')
        .set('X-SmartBord-Client', 'public')
        .set(header, value)
        .send({ query: list, variables: { input: {} } })
        .expect(403);
    expect(
      (
        await call(
          '{...R}fragment R on Query{x:communityPosts(input:{}){total}}',
        )
      ).body.data.x.total,
    ).toBe(0);
  });
  it('preserves community states across a real backend restart', async () => {
    const published = await change(await make(), { state: 'PUBLISHED' });
    const draft = await make();
    const removed = await moderation(await make(), 'REMOVE', 'SPAM');
    await app.close();
    await open();
    assertExactTestDatabase(connection, name);
    expect(
      (await call(detail, { id: published.id })).body.data.communityPost.id,
    ).toBe(published.id);
    for (const entry of [draft, removed])
      expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    expect(
      (await call(own, { id: removed.id }, member.token)).body.data
        .myCommunityPost.removalReason,
    ).toBe('SPAM');
  });
});
