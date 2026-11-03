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
import { HelpSchemaService } from '../src/modules/help-center/help-schema.service';
import {
  configureDisposableDatabase,
  assertInitiallyEmpty,
  assertExactTestDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

const detail =
  'query($id:ID!){helpEntry(id:$id){id kind title bodyMarkdown topic order publishedAt updatedAt}}';
const list =
  'query($input:HelpEntriesInput!){helpEntries(input:$input){items{id title topic order publishedAt}page pageSize total}}';
const fields =
  'id kind title bodyMarkdown topic state revision order createdByUserId updatedByUserId createdAt updatedAt publishedAt';
const create = `mutation($input:CreateHelpEntryInput!){adminCreateHelpEntry(input:$input){${fields}}}`;
const update = `mutation($input:UpdateHelpEntryInput!){adminUpdateHelpEntry(input:$input){${fields}}}`;
const password = 'Synthetic-help-integration-password';
type Entry = {
  id: string;
  revision: number;
  state: string;
  title: string;
  publishedAt: string | null;
  createdByUserId: string;
  bodyMarkdown: string;
};
type Actor = { id: string; token: string };
describe('published help on guarded disposable MongoDB', () => {
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
          kind: 'FAQ',
          title: 'Synthetic question',
          bodyMarkdown: 'A **safe** answer.',
          topic: 'GENERAL',
          ...extra,
        },
      },
      admin.token,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.adminCreateHelpEntry as Entry;
  }
  async function change(
    entry: Entry,
    extra: object = {},
    token = admin.token,
  ): Promise<Entry> {
    const response = await call(
      update,
      { input: { id: entry.id, expectedRevision: entry.revision, ...extra } },
      token,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.adminUpdateHelpEntry as Entry;
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
    await app.get(HelpSchemaService).prepare();
    admin = await actor('ADMIN');
    other = await actor('ADMIN');
    member = await actor('USER');
  });
  beforeEach(async () => {
    assertExactTestDatabase(connection, name);
    for (const collection of ['helpEntries', 'auditEvents', 'authAttempts'])
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
  it('creates only drafts with server authors, then publishes safe public types', async () => {
    let entry = await make();
    expect(entry.state).toBe('DRAFT');
    expect(entry.revision).toBe(1);
    expect(entry.createdByUserId).toBe(admin.id);
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    expect(
      (await call(list, { input: { kind: 'FAQ' } })).body.data.helpEntries
        .total,
    ).toBe(0);
    entry = await change(entry, { state: 'PUBLISHED' });
    expect(entry.publishedAt).toBeTruthy();
    const response = await call(detail, { id: entry.id }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.helpEntry.bodyMarkdown).toBe(
      'A **safe** answer.',
    );
    expect(JSON.stringify(response.body)).not.toContain(admin.id);
    await call(
      'query{helpEntry(id:"' + entry.id + '"){revision createdByUserId}}',
    ).expect(400);
    await call(
      'query{helpEntries(input:{kind:FAQ}){items{bodyMarkdown}}}',
    ).expect(400);
  });
  it('enforces USER/anonymous rejection and forbids forged metadata', async () => {
    expect(
      code(
        await call(
          create,
          {
            input: {
              kind: 'FAQ',
              title: 'X',
              bodyMarkdown: 'Y',
              topic: 'GENERAL',
            },
          },
          member.token,
        ),
      ),
    ).toBe('FORBIDDEN');
    await call(create, {
      input: { kind: 'FAQ', title: 'X', bodyMarkdown: 'Y', topic: 'GENERAL' },
    }).expect(401);
    await call(
      create,
      {
        input: {
          kind: 'FAQ',
          title: 'X',
          bodyMarkdown: 'Y',
          topic: 'GENERAL',
          createdByUserId: other.id,
        },
      },
      admin.token,
    ).expect(400);
    expect(await connection.collection('helpEntries').countDocuments()).toBe(0);
  });
  it('rejects protected roots through aliases, fragments, directives, batching and multiple operations', async () => {
    const queries = [
      '{x:currentAccount{id}}',
      'query{...R} fragment R on Query{currentAccount{id}}',
      '{helpEntries(input:{kind:FAQ}){total} currentAccount @skip(if:true){id}}',
      'query A{helpEntries(input:{kind:FAQ}){total}}query B{currentAccount{id}}',
      '{__schema{queryType{name}}}',
    ];
    for (const query of queries) {
      const response = await call(query);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.data).toBeUndefined();
    }
    await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'public')
      .send([{ query: list, variables: { input: { kind: 'FAQ' } } }])
      .expect(400);
    const entry = await change(await make(), { state: 'PUBLISHED' });
    const allowed = await call(
      'query($id:ID!){...R}fragment R on Query{x:helpEntry(id:$id){id}}',
      { id: entry.id },
    ).expect(200);
    expect(allowed.body.data.x.id).toBe(entry.id);
  });
  it('rejects public credentials/origins while leaving auth endpoints protected', async () => {
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
        .send({ query: list, variables: { input: { kind: 'FAQ' } } })
        .expect(403);
    await api()
      .post('/auth/signup')
      .set('X-SmartBord-Client', 'public')
      .send({})
      .expect(400);
    await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'native')
      .send({ query: '{currentAccount{id}}' })
      .expect(401);
  });
  it('validates titles, UTF-8 body bytes, topic/kind rules and request limits', async () => {
    for (const extra of [
      { title: ' ' },
      { title: 'x'.repeat(161) },
      { bodyMarkdown: ' ' },
      { bodyMarkdown: '한'.repeat(6000) },
      { kind: 'ANNOUNCEMENT', topic: 'GENERAL' },
      { kind: 'FAQ', topic: undefined },
      { order: -1 },
      { bodyMarkdown: 'invalid\u0000body' },
    ]) {
      const response = await call(
        create,
        {
          input: {
            kind: 'FAQ',
            title: 'Test',
            bodyMarkdown: 'Answer',
            topic: 'GENERAL',
            ...extra,
          },
        },
        admin.token,
      );
      expect(code(response)).toBe('VALIDATION_ERROR');
    }
    const long = await make({ bodyMarkdown: '한'.repeat(5000) });
    expect(long.bodyMarkdown.length).toBe(5000);
    await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'native')
      .send({ query: ' '.repeat(8193) })
      .expect(413);
    await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'native')
      .send({
        query: create,
        variables: { input: { bodyMarkdown: 'x'.repeat(66000) } },
      })
      .expect(413);
    await api()
      .post('/auth/signup')
      .set('X-SmartBord-Client', 'native')
      .send({ password: 'x'.repeat(9000) })
      .expect(413);
  });
  it('orders and paginates FAQ/topic and announcement summaries deterministically', async () => {
    const late = await change(await make({ order: 20, topic: 'PRIVACY' }), {
      state: 'PUBLISHED',
    });
    const first = await change(await make({ order: 0 }), {
      state: 'PUBLISHED',
    });
    const second = await change(await make({ order: 5 }), {
      state: 'PUBLISHED',
    });
    const response = await call(list, {
      input: { kind: 'FAQ', page: 2, pageSize: 1 },
    });
    expect(response.body.data.helpEntries).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 3,
      items: [{ id: second.id }],
    });
    expect(
      (await call(list, { input: { kind: 'FAQ', topic: 'PRIVACY' } })).body.data
        .helpEntries.items[0].id,
    ).toBe(late.id);
    expect(
      (await call(list, { input: { kind: 'FAQ' } })).body.data.helpEntries
        .items[0].id,
    ).toBe(first.id);
    const older = await change(
      await make({ kind: 'ANNOUNCEMENT', topic: undefined }),
      { state: 'PUBLISHED' },
    );
    const newer = await change(
      await make({ kind: 'ANNOUNCEMENT', topic: undefined }),
      { state: 'PUBLISHED' },
    );
    expect(
      (
        await call(list, { input: { kind: 'ANNOUNCEMENT' } })
      ).body.data.helpEntries.items.map((x: { id: string }) => x.id),
    ).toEqual([newer.id, older.id]);
    expect(
      code(
        await call(list, { input: { kind: 'ANNOUNCEMENT', topic: 'GENERAL' } }),
      ),
    ).toBe('VALIDATION_ERROR');
  });
  it('edits live, unpublishes, archives and restores only to draft', async () => {
    let entry = await change(await make(), { state: 'PUBLISHED' });
    entry = await change(entry, { title: 'Changed live' });
    expect(
      (await call(detail, { id: entry.id })).body.data.helpEntry.title,
    ).toBe('Changed live');
    entry = await change(entry, { state: 'DRAFT' });
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    entry = await change(entry, { state: 'PUBLISHED' });
    entry = await change(entry, { state: 'ARCHIVED' });
    expect(code(await call(detail, { id: entry.id }))).toBe('NOT_FOUND');
    for (const extra of [
      { title: 'Forbidden' },
      { state: 'PUBLISHED' },
      { state: 'DRAFT', title: 'Forbidden' },
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
            admin.token,
          ),
        ),
      ).toBe('VALIDATION_ERROR');
    entry = await change(entry, { state: 'DRAFT' });
    expect(entry.createdByUserId).toBe(admin.id);
  });
  it('keeps no-ops unchanged and rejects stale revisions and null/empty updates', async () => {
    const entry = await make();
    const noOp = await change(entry, { title: entry.title });
    expect(noOp.revision).toBe(entry.revision);
    expect(
      await connection
        .collection('auditEvents')
        .countDocuments({ action: 'HELP_ENTRY_CHANGED' }),
    ).toBe(1);
    await change(entry, { title: 'New title' });
    expect(
      code(
        await call(
          update,
          {
            input: {
              id: entry.id,
              expectedRevision: entry.revision,
              title: 'Stale',
            },
          },
          admin.token,
        ),
      ),
    ).toBe('CONFLICT');
    for (const extra of [{}, { title: null }])
      expect(
        code(
          await call(
            update,
            { input: { id: entry.id, expectedRevision: 2, ...extra } },
            admin.token,
          ),
        ),
      ).toBe('VALIDATION_ERROR');
  });
  it('serializes concurrent edits and never stores content in audit metadata', async () => {
    const entry = await make();
    const responses = await Promise.all(
      [admin, other].map((person, index) =>
        call(
          update,
          {
            input: {
              id: entry.id,
              expectedRevision: entry.revision,
              title: `Editor ${index}`,
            },
          },
          person.token,
        ),
      ),
    );
    expect(responses.filter((x) => code(x) === 'CONFLICT')).toHaveLength(1);
    expect(responses.filter((x) => x.body.data)).toHaveLength(1);
    const events = await connection
      .collection('auditEvents')
      .find({ action: 'HELP_ENTRY_CHANGED' })
      .toArray();
    expect(events).toHaveLength(2);
    expect(events[0].subjectUserId).toBeUndefined();
    expect(events[0].subjectHelpEntryId).toBe(entry.id);
    expect(JSON.stringify(events)).not.toContain(entry.bodyMarkdown);
    expect(JSON.stringify(events)).not.toContain(entry.title);
  });
  it('rolls back content creation/update when audit insertion fails', async () => {
    jest
      .spyOn(app.get(AuditService), 'helpChanged')
      .mockRejectedValueOnce(new Error('synthetic audit failure'));
    expect(
      code(
        await call(
          create,
          {
            input: {
              kind: 'FAQ',
              title: 'X',
              bodyMarkdown: 'Y',
              topic: 'GENERAL',
            },
          },
          admin.token,
        ),
      ),
    ).toBe('INTERNAL_ERROR');
    expect(await connection.collection('helpEntries').countDocuments()).toBe(0);
    const entry = await make();
    jest
      .spyOn(app.get(AuditService), 'helpChanged')
      .mockRejectedValueOnce(new Error('synthetic audit failure'));
    expect(
      code(
        await call(
          update,
          { input: { id: entry.id, expectedRevision: 1, state: 'PUBLISHED' } },
          admin.token,
        ),
      ),
    ).toBe('INTERNAL_ERROR');
    expect(
      (
        await connection
          .collection('helpEntries')
          .findOne({ _id: entry.id } as never)
      )?.state,
    ).toBe('DRAFT');
  });
  it('fails closed without content indexes and recovers after explicit preparation', async () => {
    await connection
      .collection('helpEntries')
      .dropIndex('kind_1_state_1_order_1_createdAt_1__id_1');
    try {
      expect(code(await call(list, { input: { kind: 'FAQ' } }))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(HelpSchemaService).prepare();
    }
    expect(
      (await call(list, { input: { kind: 'FAQ' } })).body.data.helpEntries
        .total,
    ).toBe(0);
  });
  it('shares the 20-write budget across creation, edits and publication', async () => {
    if (Date.now() % 60000 > 58000)
      await new Promise((resolve) => setTimeout(resolve, 2100));
    await app
      .get(AuthRateLimitService)
      .consume('help:write:account', admin.id, 20, 20);
    expect(
      code(
        await call(
          create,
          {
            input: {
              kind: 'FAQ',
              title: 'X',
              bodyMarkdown: 'Y',
              topic: 'GENERAL',
            },
          },
          admin.token,
        ),
      ),
    ).toBe('RATE_LIMITED');
    expect(await connection.collection('helpEntries').countDocuments()).toBe(0);
  });
  it('rechecks current admin access against concurrent account revocation', async () => {
    const editor = await actor('ADMIN');
    const entry = await make();
    const block =
      'mutation($input:UpdateAccountAccessInput!){adminUpdateAccountAccess(input:$input){id status}}';
    const [saved, blocked] = await Promise.all([
      call(
        update,
        {
          input: {
            id: entry.id,
            expectedRevision: 1,
            title: 'Concurrent edit',
          },
        },
        editor.token,
      ),
      call(block, { input: { id: editor.id, status: 'BLOCKED' } }, admin.token),
    ]);
    expect(blocked.body.data.adminUpdateAccountAccess.status).toBe('BLOCKED');
    expect(saved.body.data || code(saved) === 'UNAUTHENTICATED').toBeTruthy();
    const current = await connection
      .collection('helpEntries')
      .findOne({ _id: entry.id } as never);
    await call(
      update,
      {
        input: {
          id: entry.id,
          expectedRevision: current!.revision,
          title: 'Must not save',
        },
      },
      editor.token,
    ).expect(401);
    expect(
      (
        await connection
          .collection('helpEntries')
          .findOne({ _id: entry.id } as never)
      )?.title,
    ).not.toBe('Must not save');
  });
  it('preserves published and draft platform records across a backend restart', async () => {
    const published = await change(await make(), { state: 'PUBLISHED' });
    const draft = await make();
    await app.close();
    await open();
    assertExactTestDatabase(connection, name);
    expect(
      (await call(detail, { id: published.id })).body.data.helpEntry.id,
    ).toBe(published.id);
    expect(code(await call(detail, { id: draft.id }))).toBe('NOT_FOUND');
    expect(await connection.collection('helpEntries').countDocuments()).toBe(2);
  });
});
