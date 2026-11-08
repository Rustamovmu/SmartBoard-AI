import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection, Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { digest } from '../src/modules/auth/token.service';
import { MembersService } from '../src/modules/members/members.service';
import {
  MEMBER_MODEL,
  Member,
} from '../src/modules/members/schemas/member.schema';
import {
  assertExactTestDatabase,
  assertInitiallyEmpty,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

describe('username identity with disposable MongoDB', () => {
  let app: NestExpressApplication, connection: Connection, users: Model<Member>;
  let name: string,
    owned = false,
    passwordHash: string;
  const password = 'synthetic-username-password';
  const native = { 'X-SmartBord-Client': 'native' };
  const api = () => request(app.getHttpServer());
  const signup = (username?: unknown) =>
    api()
      .post('/auth/signup')
      .set(native)
      .send({
        email: `${randomUUID()}@example.test`,
        name: 'Same Full Name',
        password,
        ...(username === undefined ? {} : { username }),
      });
  const login = (identifier: string, value = password) =>
    api().post('/auth/login').set(native).send({ identifier, password: value });
  const claim = (access: string, username: unknown, extra = {}) =>
    api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${access}`)
      .send({
        query:
          'mutation($input: SetMyUsernameInput!) { setMyUsername(input: $input) { id email username name role status } }',
        variables: { input: { username, ...extra } },
      });
  const fixture = async (role: 'USER' | 'ADMIN' = 'USER') => {
    const email = `${randomUUID()}@example.test`;
    const user = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create({ email, name: 'Same Full Name', passwordHash }, role, session);
    });
    const grant = await api()
      .post('/auth/login')
      .set(native)
      .send({ email, password })
      .expect(200);
    return {
      id: user._id,
      email,
      access: grant.body.accessToken as string,
      refresh: grant.body.refreshToken as string,
    };
  };
  const code = (response: request.Response) =>
    response.body.errors?.[0]?.extensions?.code;
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

  it('normalizes a distinct signup username and accepts username, identifier email and legacy email login', async () => {
    const result = await signup('  My_User42  ').expect(201);
    expect(result.body.user).toMatchObject({
      username: 'my_user42',
      name: 'Same Full Name',
      role: 'USER',
    });
    for (const identifier of ['  MY_User42  ', result.body.user.email]) {
      const signed = await login(identifier).expect(200);
      expect(signed.body.user.id).toBe(result.body.user.id);
    }
    await api()
      .post('/auth/login')
      .set(native)
      .send({ email: result.body.user.email.toUpperCase(), password })
      .expect(200);
    await login('my_user42', 'wrong-password').expect(401);
    await login('Same Full Name').expect(400);
    await signup('different_user').expect(201);
    expect(await users.countDocuments({ name: 'Same Full Name' })).toBe(2);
  });
  it('preserves legacy accounts and permits multiple missing usernames without a backfill', async () => {
    const a = await signup().expect(201),
      b = await signup().expect(201);
    expect(a.body.user.username).toBeNull();
    expect(b.body.user.username).toBeNull();
    await app.get(AuthSchemaService).prepare();
    expect(await users.countDocuments({ username: { $exists: false } })).toBe(
      2,
    );
    await login(a.body.user.email).expect(200);
  });
  it('rejects malformed/ambiguous identities and unknown signup fields', async () => {
    for (const identity of [
      {},
      { email: 'a@example.test', identifier: 'abc' },
      { identifier: null },
      { identifier: { $ne: null } },
      { identifier: 'a' },
      { identifier: '1abc' },
      { identifier: 'user-name' },
      { identifier: 'a'.repeat(31) },
      { email: 'username' },
    ]) {
      await api()
        .post('/auth/login')
        .set(native)
        .send({ ...identity, password })
        .expect(400);
    }
    // Reset only the guarded fixture's request budget between independent input groups.
    await connection.db!.collection('authAttempts').deleteMany({});
    for (const value of [
      null,
      { $ne: null },
      'a',
      '1abc',
      'has space',
      'has.dot',
      'a'.repeat(31),
      'üser',
    ])
      await signup(value).expect(400);
    await api()
      .post('/auth/signup')
      .set(native)
      .send({
        email: 'unknown@example.test',
        name: 'Name',
        username: 'valid_user',
        password,
        role: 'ADMIN',
      })
      .expect(400);
    expect(await users.countDocuments()).toBe(0);
  });
  it('allows exactly one concurrent signup for a normalized username and rolls back the loser', async () => {
    const results = await Promise.all([
      signup('Race_User'),
      signup('race_user'),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await users.countDocuments()).toBe(1);
    expect(
      await connection.db!.collection('authSessions').countDocuments(),
    ).toBe(1);
  });
  it('shares the account login budget across aliases before password verification', async () => {
    const owner = await signup('shared_alias').expect(201);
    const minute = Math.floor(Date.now() / 60000);
    for (const bucket of [minute, minute + 1])
      await connection.db!.collection('authAttempts').updateOne(
        {
          _id: digest(
            `login:account:user:${owner.body.user.id}:${bucket}`,
          ) as never,
        },
        { $set: { count: 4, expiresAt: new Date(Date.now() + 180000) } },
        { upsert: true },
      );
    const verify = jest.spyOn(app.get(PasswordService), 'verify');
    try {
      await login('SHARED_ALIAS', 'wrong-password').expect(401);
      await api()
        .post('/auth/login')
        .set(native)
        .send({ email: owner.body.user.email, password })
        .expect(429);
      await login(owner.body.user.email).expect(429);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  });
  it.each(['USER', 'ADMIN'] as const)(
    'lets an active %s choose once, idempotently, without changing credentials or sessions',
    async (role) => {
      const owner = await fixture(role);
      const before = await users
        .findById(owner.id)
        .select('+passwordHash +authVersion')
        .lean();
      const chosen = await claim(owner.access, '  Chosen_User  ');
      expect(chosen.body.data?.setMyUsername).toMatchObject({
        id: owner.id,
        username: 'chosen_user',
        role,
        status: 'ACTIVE',
      });
      expect(
        (await claim(owner.access, 'chosen_user')).body.data?.setMyUsername
          .username,
      ).toBe('chosen_user');
      expect(code(await claim(owner.access, 'renamed_user'))).toBe('CONFLICT');
      const after = await users
        .findById(owner.id)
        .select('+passwordHash +authVersion')
        .lean();
      expect(after!.passwordHash).toBe(before!.passwordHash);
      expect(after!.authVersion).toBe(before!.authVersion);
      await api()
        .get('/auth/me')
        .set(native)
        .set('Authorization', `Bearer ${owner.access}`)
        .expect(200);
      await api()
        .post('/auth/refresh')
        .set(native)
        .send({ refreshToken: owner.refresh })
        .expect(200);
      await login('chosen_user').expect(200);
      await login(owner.email).expect(200);
      const events = await connection
        .db!.collection('auditEvents')
        .find({ action: 'USERNAME_SET' })
        .toArray();
      expect(events).toHaveLength(1);
      expect(events[0].subjectUserId).toBe(owner.id);
      expect(JSON.stringify(events)).not.toMatch(
        /chosen_user|Same Full Name|password/,
      );
    },
  );
  it('protects claims with authentication, current status, owner-only input and browser CSRF', async () => {
    const owner = await fixture();
    expect(code(await claim('invalid', 'safe_user'))).toBe('UNAUTHENTICATED');
    expect(
      code(await claim(owner.access, 'safe_user', { id: randomUUID() })),
    ).toBe('VALIDATION_ERROR');
    expect(code(await claim(owner.access, null))).toBe('VALIDATION_ERROR');
    const publicCall = await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'public')
      .send({
        query: 'mutation { setMyUsername(input:{username:"safe_user"}) {id} }',
      });
    expect(publicCall.body.data?.setMyUsername).toBeUndefined();
    await api()
      .post('/graphql')
      .set('X-SmartBord-Client', 'browser')
      .set('Origin', 'https://localhost:3000')
      .send({
        query: 'mutation {setMyUsername(input:{username:"safe_user"}) {id}}',
      })
      .expect(403);
    await users.updateOne({ _id: owner.id }, { $set: { status: 'BLOCKED' } });
    expect(code(await claim(owner.access, 'safe_user'))).toBe('FORBIDDEN');
    expect((await users.findById(owner.id).lean())!.username).toBeUndefined();
  });
  it('serializes competing owners and competing choices for one owner', async () => {
    const a = await fixture(),
      b = await fixture();
    const results = await Promise.all([
      claim(a.access, 'contended_user'),
      claim(b.access, 'CONTENDED_USER'),
    ]);
    expect(results.filter((r) => r.body.data?.setMyUsername)).toHaveLength(1);
    expect(results.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    const c = await fixture();
    const choices = await Promise.all([
      claim(c.access, 'first_choice'),
      claim(c.access, 'second_choice'),
    ]);
    expect(choices.filter((r) => r.body.data?.setMyUsername)).toHaveLength(1);
    expect(choices.filter((r) => code(r) === 'CONFLICT')).toHaveLength(1);
    expect(
      await connection
        .db!.collection('auditEvents')
        .countDocuments({ action: 'USERNAME_SET' }),
    ).toBe(2);
  });
  it('rolls back the claim when auditing fails and keeps blocked usernames reserved', async () => {
    const owner = await fixture();
    const audit = jest
      .spyOn(app.get(AuditService), 'usernameSet')
      .mockRejectedValueOnce(new Error('synthetic-error'));
    try {
      expect(code(await claim(owner.access, 'rollback_user'))).toBe(
        'INTERNAL_ERROR',
      );
    } finally {
      audit.mockRestore();
    }
    expect((await users.findById(owner.id).lean())!.username).toBeUndefined();
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(0);
    expect(
      (await claim(owner.access, 'rollback_user')).body.data?.setMyUsername
        .username,
    ).toBe('rollback_user');
    await users.updateOne({ _id: owner.id }, { $set: { status: 'BLOCKED' } });
    await signup('rollback_user').expect(409);
    await login('rollback_user').expect(401);
  });
  it('fails closed without the unique sparse index and prepares without rewriting existing accounts', async () => {
    const owner = await fixture();
    assertExactTestDatabase(connection, name);
    await users.collection.dropIndex('unique_normalized_username');
    try {
      await login(owner.email).expect(503);
      await api().get('/health/ready').expect(503);
      expect(code(await claim(owner.access, 'safe_user'))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(AuthSchemaService).prepare();
    }
    const index = (await users.listIndexes()).find(
      (i) => i.name === 'unique_normalized_username',
    );
    expect(index).toMatchObject({
      key: { username: 1 },
      unique: true,
      sparse: true,
    });
    expect((await users.findById(owner.id).lean())!.username).toBeUndefined();
    await login(owner.email).expect(200);
  });
});
