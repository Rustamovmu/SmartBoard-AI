import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection, Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { digest } from '../src/modules/auth/token.service';
import { MembersService } from '../src/modules/members/members.service';
import {
  MEMBER_MODEL,
  Member,
} from '../src/modules/members/schemas/member.schema';
import { AuditService } from '../src/modules/audit/audit.service';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { ADMIN_POLICY_ID } from '../src/modules/admin/schemas/admin-policy.schema';
import {
  assertExactTestDatabase,
  assertInitiallyEmpty,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

describe('GraphQL administrator policies with disposable MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let name: string;
  let owned = false;
  let users: Model<Member>;
  let passwordHash: string;
  const password = 'synthetic-admin-integration-password';
  const native = { 'X-SmartBord-Client': 'native' };
  const accountFields = 'id email name role status createdAt';
  const currentQuery = `query { currentAccount { ${accountFields} } }`;
  const listQuery = `query($input: AccountsInput!) { adminAccounts(input: $input) { items { ${accountFields} } page pageSize total } }`;
  const updateQuery = `mutation($input: UpdateAccountAccessInput!) { adminUpdateAccountAccess(input: $input) { ${accountFields} } }`;
  const api = () => request(app.getHttpServer());
  const gql = (
    token: string | undefined,
    query: string,
    variables?: object,
  ) => {
    const call = api().post('/graphql').set(native);
    if (token) call.set('Authorization', `Bearer ${token}`);
    return call.send({ query, variables });
  };
  const update = (token: string, input: object) =>
    gql(token, updateQuery, { input });
  const login = (email: string) =>
    api().post('/auth/login').set(native).send({ email, password });
  const fixture = async (role: 'USER' | 'ADMIN' = 'ADMIN') => {
    const email = `synthetic-${randomUUID()}@example.test`;
    const user = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create(
          { email, name: 'Synthetic Account', passwordHash },
          role,
          session,
        );
    });
    const grant = await login(email).expect(200);
    return { ...grant.body, id: user._id, email } as {
      id: string;
      email: string;
      accessToken: string;
      refreshToken: string;
    };
  };
  const errorCode = (result: {
    body: { errors?: { extensions: { code: string } }[] };
  }) => result.body.errors?.[0].extensions.code;

  beforeAll(async () => {
    name = configureDisposableDatabase();
    connection = await openPlatformConnection(
      parseDatabaseEnvironment(process.env, 'test'),
    );
    await assertInitiallyEmpty(connection, name);
    owned = true;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    users = app.get<Model<Member>>(getModelToken(MEMBER_MODEL));
    passwordHash = await app.get(PasswordService).hash(password);
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    assertExactTestDatabase(connection, name);
    for (const collection of [
      'users',
      'authSessions',
      'authAttempts',
      'auditEvents',
    ])
      await connection.db!.collection(collection).deleteMany({});
  });
  afterAll(async () => {
    try {
      if (owned) await dropOwnedTestDatabase(connection, name);
    } finally {
      if (app) await app.close();
      else if (connection) await connection.close();
    }
  });

  it('matches the versioned schema and exposes only safe current-account fields', async () => {
    expect(
      `${printSchema(lexicographicSortSchema(app.get(GraphQLSchemaHost).schema))}\n`,
    ).toBe(readFileSync('contracts/schema.graphql', 'utf8'));
    const user = await fixture('USER');
    const result = await gql(user.accessToken, currentQuery)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body).toEqual({
      data: {
        currentAccount: {
          id: user.id,
          email: user.email,
          name: 'Synthetic Account',
          role: 'USER',
          status: 'ACTIVE',
          createdAt: expect.any(String),
        },
      },
    });
    expect(errorCode(await gql(undefined, currentQuery).expect(401))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects USER access to administrator reads and writes without IDOR or audit writes', async () => {
    const admin = await fixture();
    const user = await fixture('USER');
    expect(
      errorCode(await gql(user.accessToken, listQuery, { input: {} })),
    ).toBe('FORBIDDEN');
    expect(
      errorCode(
        await update(user.accessToken, { id: admin.id, status: 'BLOCKED' }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await users.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
    ).toBe(1);
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(0);
  });

  it('paginates and filters account lists with stable bounds and rejects invalid inputs', async () => {
    const admin = await fixture();
    await fixture('USER');
    const page = await gql(admin.accessToken, listQuery, {
      input: { page: 1, pageSize: 1, role: 'USER' },
    }).expect(200);
    expect(page.body.data.adminAccounts).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      items: [expect.objectContaining({ role: 'USER' })],
    });
    for (const input of [
      { page: 0 },
      { pageSize: 101 },
      { page: 10001 },
      { role: null },
      { status: null },
      { lectureTitle: 'synthetic-private-marker' },
    ])
      expect(
        errorCode(await gql(admin.accessToken, listQuery, { input })),
      ).toBe('VALIDATION_ERROR');
    for (const input of [
      { id: admin.id },
      { id: admin.id, role: null },
      { id: 'bad-id', status: 'BLOCKED' },
      { id: { $ne: null }, role: 'USER' },
    ])
      expect(errorCode(await update(admin.accessToken, input))).toBe(
        'VALIDATION_ERROR',
      );
    expect(
      errorCode(
        await update(admin.accessToken, {
          id: randomUUID(),
          status: 'BLOCKED',
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it.each([{ role: 'USER' }, { status: 'BLOCKED' }, { status: 'DELETED' }])(
    'preserves the last active admin for %j',
    async (change) => {
      const admin = await fixture();
      expect(
        errorCode(await update(admin.accessToken, { id: admin.id, ...change })),
      ).toBe('CONFLICT');
      expect(
        await users.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
      ).toBe(1);
      expect(
        await connection.db!.collection('auditEvents').countDocuments(),
      ).toBe(0);
      expect(
        (await gql(admin.accessToken, currentQuery)).body.data.currentAccount
          .role,
      ).toBe('ADMIN');
    },
  );

  it('revokes every target session and audits atomic block/reactivation without restoring credentials', async () => {
    const admin = await fixture();
    const user = await fixture('USER');
    const second = await login(user.email).expect(200);
    const blocked = await update(admin.accessToken, {
      id: user.id,
      status: 'BLOCKED',
    }).expect(200);
    expect(blocked.body.data.adminUpdateAccountAccess.status).toBe('BLOCKED');
    const events = await connection
      .db!.collection('auditEvents')
      .find({ subjectUserId: user.id })
      .toArray();
    expect(events).toMatchObject([
      {
        action: 'ACCOUNT_ACCESS_CHANGED',
        actorType: 'ADMIN',
        actorUserId: admin.id,
        previousStatus: 'ACTIVE',
        nextStatus: 'BLOCKED',
        previousRole: 'USER',
        nextRole: 'USER',
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /password|Hash|Token|synthetic-private/,
    );
    for (const token of [user.accessToken, second.body.accessToken])
      expect(errorCode(await gql(token, currentQuery).expect(401))).toBe(
        'UNAUTHENTICATED',
      );
    await api()
      .post('/auth/refresh')
      .set(native)
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    await login(user.email).expect(401);
    await update(admin.accessToken, { id: user.id, status: 'ACTIVE' }).expect(
      200,
    );
    expect(
      errorCode(await gql(user.accessToken, currentQuery).expect(401)),
    ).toBe('UNAUTHENTICATED');
    await login(user.email).expect(200);
    const stored = await users.findById(user.id).select('+authVersion').lean();
    expect(stored!.authVersion).toBe(2);
  });

  it('requires fresh login after promotion/demotion and permits soft deletion with another active admin', async () => {
    const admin = await fixture();
    const target = await fixture('USER');
    const result = await update(admin.accessToken, {
      id: target.id,
      role: 'ADMIN',
    }).expect(200);
    expect(result.body.data.adminUpdateAccountAccess.role).toBe('ADMIN');
    expect(
      errorCode(
        await gql(target.accessToken, listQuery, { input: {} }).expect(401),
      ),
    ).toBe('UNAUTHENTICATED');
    const promoted = await login(target.email).expect(200);
    expect(
      (await gql(promoted.body.accessToken, listQuery, { input: {} })).body.data
        .adminAccounts.total,
    ).toBe(2);
    await update(admin.accessToken, { id: target.id, role: 'USER' }).expect(
      200,
    );
    expect(
      errorCode(
        await gql(promoted.body.accessToken, listQuery, { input: {} }).expect(
          401,
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    await update(admin.accessToken, {
      id: target.id,
      status: 'DELETED',
    }).expect(200);
    expect(
      await users.countDocuments({ _id: target.id, status: 'DELETED' }),
    ).toBe(1);
    await login(target.email).expect(401);
    const other = await fixture();
    expect(
      (await update(other.accessToken, { id: admin.id, status: 'DELETED' }))
        .body.data.adminUpdateAccountAccess.status,
    ).toBe('DELETED');
  });

  it('serializes concurrent self-demotions, preserving exactly one active administrator', async () => {
    const first = await fixture();
    const second = await fixture();
    const results = await Promise.all([
      update(first.accessToken, { id: first.id, role: 'USER' }),
      update(second.accessToken, { id: second.id, role: 'USER' }),
    ]);
    expect(
      results.filter((r) => r.body.data?.adminUpdateAccountAccess),
    ).toHaveLength(1);
    expect(results.map(errorCode)).toContain('CONFLICT');
    expect(
      await users.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
    ).toBe(1);
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(1);
  });

  it('rechecks the actor inside concurrent cross-block transactions', async () => {
    const first = await fixture();
    const second = await fixture();
    const results = await Promise.all([
      update(first.accessToken, { id: second.id, status: 'BLOCKED' }),
      update(second.accessToken, { id: first.id, status: 'BLOCKED' }),
    ]);
    expect(
      results.filter((r) => r.body.data?.adminUpdateAccountAccess),
    ).toHaveLength(1);
    expect(
      results.some((r) =>
        ['UNAUTHENTICATED', 'FORBIDDEN'].includes(errorCode(r) ?? ''),
      ),
    ).toBe(true);
    expect(
      await users.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
    ).toBe(1);
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(1);
  });

  it('rolls back account and session changes on audit failure and treats no-op changes as no-op', async () => {
    const admin = await fixture();
    const target = await fixture('USER');
    const spy = jest
      .spyOn(app.get(AuditService), 'accountAccessChanged')
      .mockRejectedValueOnce(new Error('synthetic-private-marker'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const result = await update(admin.accessToken, {
        id: target.id,
        status: 'BLOCKED',
      });
      expect(errorCode(result)).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(result.body)).not.toContain(
        'synthetic-private-marker',
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'synthetic-private-marker',
      );
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    expect(
      (await gql(target.accessToken, currentQuery)).body.data.currentAccount
        .status,
    ).toBe('ACTIVE');
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(0);
    await update(admin.accessToken, {
      id: target.id,
      role: 'USER',
      status: 'ACTIVE',
    }).expect(200);
    expect(
      (await users.findById(target.id).select('+authVersion').lean())!
        .authVersion,
    ).toBe(0);
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(0);
  });

  it('requires explicit policy preparation and preserves existing revision on repeated setup', async () => {
    const admin = await fixture();
    const target = await fixture('USER');
    const settings = connection.db!.collection('platformSettings');
    const initial = await settings.findOne({ _id: ADMIN_POLICY_ID as never });
    await app.get(AdminPolicyService).prepare();
    expect(
      (await settings.findOne({ _id: ADMIN_POLICY_ID as never }))!.revision,
    ).toBe(initial!.revision);
    assertExactTestDatabase(connection, name);
    await settings.deleteMany({});
    try {
      expect(
        errorCode(
          await update(admin.accessToken, { id: target.id, status: 'BLOCKED' }),
        ),
      ).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await app.get(AdminPolicyService).prepare();
    }
    expect((await users.findById(target.id).lean())!.status).toBe('ACTIVE');
  });

  it('enforces browser origin/CSRF, disables GET/batching/introspection, and redacts validation errors', async () => {
    const user = await fixture('USER');
    const browser = {
      'X-SmartBord-Client': 'browser',
      Origin: 'https://localhost:3000',
    };
    const csrf = await api().get('/auth/csrf').set(browser).expect(200);
    const csrfCookie = (
      csrf.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const signed = await api()
      .post('/auth/login')
      .set(browser)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ email: user.email, password })
      .expect(200);
    const cookie = [
      csrfCookie,
      ...(signed.headers['set-cookie'] as unknown as string[]).map(
        (c) => c.split(';')[0],
      ),
    ].join('; ');
    const requestBrowser = () =>
      api().post('/graphql').set(browser).set('Cookie', cookie);
    expect(
      errorCode(
        await requestBrowser().send({ query: currentQuery }).expect(403),
      ),
    ).toBe('FORBIDDEN');
    const result = await requestBrowser()
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ query: currentQuery })
      .expect(200);
    expect(result.body.data.currentAccount.id).toBe(user.id);
    expect(
      errorCode(
        await requestBrowser()
          .set('Origin', 'https://malicious.invalid')
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send({ query: currentQuery })
          .expect(403),
      ),
    ).toBe('FORBIDDEN');
    await api().get('/graphql').expect(405).expect('Cache-Control', 'no-store');
    await api().post('/graphql').type('form').send('query={}').expect(415);
    for (const query of [
      '{ __schema { types { name } } }',
      '{ currentAccount { passwordHash } }',
      '{ lecture(marker: "synthetic-private-marker") }',
      'query A {currentAccount{id}} query B {currentAccount{id}}',
      `{ ${Array.from({ length: 81 }, (_x, i) => `a${i}:currentAccount{id}`).join(' ')} }`,
      '{ syntactic-private-marker',
    ]) {
      const rejected = await gql(user.accessToken, query)
        .expect(400)
        .expect('Cache-Control', 'no-store');
      expect(errorCode(rejected)).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(rejected.body)).not.toMatch(
        /synthetic-private-marker|passwordHash|stacktrace|locations|suggest/,
      );
    }
    const batch = await api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send([{ query: currentQuery }])
      .expect(400);
    expect(batch.body).not.toHaveProperty('data');
  });

  it('rate-limits GraphQL requests and keeps only allowed platform collections', async () => {
    const user = await fixture('USER');
    const key = digest(
      `graphql:ip:127.0.0.1:${Math.floor(Date.now() / 60000)}`,
    );
    await connection
      .db!.collection('authAttempts')
      .updateOne(
        { _id: key as never },
        { $set: { count: 60, expiresAt: new Date(Date.now() + 120000) } },
        { upsert: true },
      );
    expect(
      errorCode(await gql(user.accessToken, currentQuery).expect(429)),
    ).toBe('RATE_LIMITED');
    expect(
      (await connection.db!.listCollections({}, { nameOnly: true }).toArray())
        .map((c) => c.name)
        .sort(),
    ).toEqual([
      'auditEvents',
      'authAttempts',
      'authSessions',
      'platformSettings',
      'users',
    ]);
  });
});
