import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection, Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { AUTH_POLICY } from '../src/contracts/auth-v1';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { CurrentAccountGuard } from '../src/modules/auth/guards/current-account.guard';
import { AdminGuard } from '../src/modules/auth/guards/admin.guard';
import {
  AUTH_SESSION_MODEL,
  AuthSession,
} from '../src/modules/auth/schemas/auth-session.schema';
import {
  AUTH_ATTEMPT_MODEL,
  AuthAttempt,
} from '../src/modules/auth/schemas/auth-attempt.schema';
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

@Controller('test-policy')
class TestPolicyController {
  @Get('admin')
  @UseGuards(CurrentAccountGuard, AdminGuard)
  admin() {
    return { success: true };
  }
}

describe('authentication with isolated real MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let name: string;
  let owned = false;
  let users: Model<Member>;
  let sessions: Model<AuthSession>;
  let attempts: Model<AuthAttempt>;
  const password = 'synthetic-integration-passphrase';
  const native = { 'X-SmartBord-Client': 'native' };
  const browser = {
    'X-SmartBord-Client': 'browser',
    Origin: 'https://localhost:3000',
  };
  const email = () => `synthetic-${randomUUID()}@example.test`;
  const api = () => request(app.getHttpServer());
  const signup = (address = email()) =>
    api()
      .post('/auth/signup')
      .set(native)
      .send({ email: address, name: 'Synthetic Test', password });
  const me = (access: string) =>
    api().get('/auth/me').set(native).set('Authorization', `Bearer ${access}`);
  const refresh = (token: string) =>
    api().post('/auth/refresh').set(native).send({ refreshToken: token });
  const cookies = (response: { headers: Record<string, unknown> }) =>
    (response.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

  beforeAll(async () => {
    name = configureDisposableDatabase();
    connection = await openPlatformConnection(
      parseDatabaseEnvironment(process.env, 'test'),
    );
    await assertInitiallyEmpty(connection, name);
    owned = true;
    const fixture = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [TestPolicyController],
    })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    users = app.get<Model<Member>>(getModelToken(MEMBER_MODEL));
    sessions = app.get<Model<AuthSession>>(getModelToken(AUTH_SESSION_MODEL));
    attempts = app.get<Model<AuthAttempt>>(getModelToken(AUTH_ATTEMPT_MODEL));
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    assertExactTestDatabase(connection, name);
    await attempts.deleteMany({});
  });

  afterAll(async () => {
    try {
      if (owned) await dropOwnedTestDatabase(connection, name);
    } finally {
      if (app) await app.close();
      else if (connection) await connection.close();
    }
  });

  it('prepares indexes idempotently and creates USER with real Argon2id and hashed credentials', async () => {
    await app.get(AuthSchemaService).prepare();
    const address = email();
    const result = await signup(`  ${address.toUpperCase()}  `).expect(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.user).toMatchObject({
      email: address,
      name: 'Synthetic Test',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(result.body).not.toHaveProperty('passwordHash');
    expect(result.body.user).not.toHaveProperty('passwordHash');
    expect(
      Date.parse(result.body.accessExpiresAt) - Date.now(),
    ).toBeLessThanOrEqual(AUTH_POLICY.accessLifetimeMs);
    expect(
      Date.parse(result.body.sessionExpiresAt) - Date.now(),
    ).toBeLessThanOrEqual(AUTH_POLICY.sessionLifetimeMs);
    const stored = await users
      .findById(result.body.user.id)
      .select('+passwordHash')
      .lean();
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
    const record = await sessions
      .findOne({ userId: stored!._id })
      .select('+accessHash +refreshHash +refreshFamilyHash')
      .lean();
    expect(record!.accessHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(result.body.refreshToken);
    expect(JSON.stringify(record)).not.toContain(result.body.accessToken);
    await me(result.body.accessToken).expect(200);
  });

  it('fails closed before signup if the unique-email index is missing', async () => {
    assertExactTestDatabase(connection, name);
    const address = email();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      await users.collection.dropIndex('unique_normalized_email');
      await signup(address).expect(503);
      expect(await users.countDocuments({ email: address })).toBe(0);
    } finally {
      await users.createIndexes();
      log.mockRestore();
    }
  });

  it('rejects privilege, unknown/private fields and MongoDB operator injection without retaining them', async () => {
    const before = await users.countDocuments();
    for (const extra of [
      { role: 'ADMIN' },
      { status: 'ACTIVE' },
      { note: 'synthetic-private-lecture-marker' },
      { userId: randomUUID() },
    ]) {
      const result = await api()
        .post('/auth/signup')
        .set(native)
        .send({ email: email(), name: 'Synthetic', password, ...extra })
        .expect(400);
      expect(JSON.stringify(result.body)).not.toContain(
        'synthetic-private-lecture-marker',
      );
    }
    await api()
      .post('/auth/login')
      .set(native)
      .send({ email: { $ne: null }, password })
      .expect(400);
    await api()
      .post('/auth/signup')
      .set(native)
      .send({ email: email(), name: 'Synthetic', password: 'short' })
      .expect(400);
    expect(await users.countDocuments()).toBe(before);
    for (const model of [users, sessions, attempts]) {
      expect(
        JSON.stringify(await model.collection.find({}).toArray()),
      ).not.toContain('synthetic-private-lecture-marker');
    }
  });

  it('enforces normalized email uniqueness under concurrent signup', async () => {
    const address = email();
    const results = await Promise.all([
      signup(address),
      signup(address.toUpperCase()),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(await users.countDocuments({ email: address })).toBe(1);
  });

  it('rolls back signup if session creation fails', async () => {
    const address = email();
    const fail = jest
      .spyOn(app.get(AuthSessionService), 'create')
      .mockRejectedValueOnce(new Error('synthetic-internal-failure'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      await signup(address).expect(500, {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
      });
      expect(await users.countDocuments({ email: address })).toBe(0);
    } finally {
      fail.mockRestore();
      log.mockRestore();
    }
  });

  it('logs in and uses the same generic rejection for unknown/wrong credentials', async () => {
    const address = email();
    await signup(address).expect(201);
    await api()
      .post('/auth/login')
      .set(native)
      .send({ email: address, password })
      .expect(200);
    const wrong = await api()
      .post('/auth/login')
      .set(native)
      .send({ email: address, password: 'wrong-synthetic-password' })
      .expect(401);
    const unknown = await api()
      .post('/auth/login')
      .set(native)
      .send({ email: email(), password })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rotates credentials, invalidates old access, and revokes the family on refresh replay', async () => {
    const first = await signup().expect(201);
    const next = await refresh(first.body.refreshToken).expect(200);
    expect(next.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(next.body.sessionExpiresAt).toBe(first.body.sessionExpiresAt);
    await me(first.body.accessToken).expect(401);
    await me(next.body.accessToken).expect(200);
    await refresh(first.body.refreshToken).expect(401);
    await me(next.body.accessToken).expect(401);
    await refresh(next.body.refreshToken).expect(401);
  });

  it('resolves concurrent refresh by revoking the family rather than accepting two winners', async () => {
    const first = await signup().expect(201);
    const results = await Promise.all([
      refresh(first.body.refreshToken),
      refresh(first.body.refreshToken),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 401]);
    await me(
      results.find((result) => result.status === 200)!.body.accessToken,
    ).expect(401);
  });

  it('does not let guessed family credentials revoke another session', async () => {
    const first = await signup().expect(201);
    const parts = (first.body.refreshToken as string).split('.');
    parts[2] = 'A'.repeat(43);
    await refresh(parts.join('.')).expect(401);
    await me(first.body.accessToken).expect(200);
  });

  it('enforces expiry before TTL cleanup and clamps rotated access to the absolute session lifetime', async () => {
    const first = await signup().expect(201);
    assertExactTestDatabase(connection, name);
    await sessions.updateOne(
      { userId: first.body.user.id },
      {
        $set: {
          accessExpiresAt: new Date(0),
          expiresAt: new Date(Date.now() + 20_000),
        },
      },
    );
    await me(first.body.accessToken).expect(401);
    const next = await refresh(first.body.refreshToken).expect(200);
    expect(Date.parse(next.body.accessExpiresAt)).toBeLessThanOrEqual(
      Date.parse(next.body.sessionExpiresAt),
    );
    await sessions.updateOne(
      { userId: first.body.user.id },
      { $set: { expiresAt: new Date(0) } },
    );
    await me(next.body.accessToken).expect(401);
    await refresh(next.body.refreshToken).expect(401);
  });

  it('enforces current account status and role and prevents reuse after blocking', async () => {
    const first = await signup().expect(201);
    const policy = () =>
      api()
        .get('/test-policy/admin')
        .set(native)
        .set('Authorization', `Bearer ${first.body.accessToken}`);
    await policy().expect(403);
    assertExactTestDatabase(connection, name);
    await users.updateOne(
      { _id: first.body.user.id },
      { $set: { role: 'ADMIN' } },
    );
    await policy().expect(200);
    await users.updateOne(
      { _id: first.body.user.id },
      { $set: { role: 'USER', status: 'BLOCKED' } },
    );
    await me(first.body.accessToken).expect(403);
    await users.updateOne(
      { _id: first.body.user.id },
      { $set: { status: 'ACTIVE' } },
    );
    await me(first.body.accessToken).expect(401);
    await refresh(first.body.refreshToken).expect(401);
  });

  it('logs out one session idempotently without revoking a different login', async () => {
    const address = email();
    const first = await signup(address).expect(201);
    const second = await api()
      .post('/auth/login')
      .set(native)
      .send({ email: address, password })
      .expect(200);
    await api()
      .post('/auth/logout')
      .set(native)
      .send({ refreshToken: first.body.refreshToken })
      .expect(200, { success: true });
    await api()
      .post('/auth/logout')
      .set(native)
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);
    await me(first.body.accessToken).expect(401);
    await me(second.body.accessToken).expect(200);
  });

  it('rate limits login by normalized account independently of the source address', async () => {
    const address = email();
    for (let i = 0; i < 5; i += 1)
      await api()
        .post('/auth/login')
        .set(native)
        .send({ email: address, password })
        .expect(401);
    await api()
      .post('/auth/login')
      .set(native)
      .send({ email: address.toUpperCase(), password })
      .expect(429);
  });

  it('rejects native/browser transport confusion, query credentials and unbounded/wrong-type bodies', async () => {
    await api()
      .post('/auth/login')
      .set(native)
      .set('Origin', 'https://malicious.invalid')
      .send({ email: email(), password })
      .expect(403);
    await api()
      .get('/auth/me')
      .set(native)
      .set('Cookie', 'unexpected=value')
      .expect(403);
    await api()
      .get('/auth/me?accessToken=synthetic-secret')
      .set(native)
      .expect(401);
    await api()
      .post('/auth/login')
      .set(native)
      .type('form')
      .send({ email: email(), password })
      .expect(415);
    await api()
      .post('/auth/login')
      .set(native)
      .send({ email: email(), password: 'X'.repeat(10_000) })
      .expect(413);
    await api()
      .post('/auth/login')
      .set(native)
      .type('json')
      .send('{ synthetic-private-malformed-json')
      .expect(400);
  });

  it('bootstraps ADMIN only through the explicit local CLI with an atomic audit event', async () => {
    const address = email();
    const run = promisify(execFile);
    const command = ['-r', 'ts-node/register', 'scripts/create-admin.ts'];
    const env = {
      ...process.env,
      ADMIN_BOOTSTRAP_EMAIL: address,
      ADMIN_BOOTSTRAP_NAME: 'Synthetic Administrator',
      ADMIN_BOOTSTRAP_PASSWORD: password,
    };
    const result = await run(process.execPath, command, {
      env,
      timeout: 30_000,
    });
    expect(result.stdout).toContain('Administrator created.');
    const user = await users.findOne({ email: address }).lean();
    expect(user!.role).toBe('ADMIN');
    const event = await connection
      .db!.collection('auditEvents')
      .findOne({ subjectUserId: user!._id });
    expect(event).toMatchObject({
      action: 'ADMIN_BOOTSTRAPPED',
      actorType: 'LOCAL_COMMAND',
    });
    expect(JSON.stringify(event)).not.toContain(password);
    await expect(
      run(process.execPath, command, { env, timeout: 30_000 }),
    ).rejects.toThrow();
    expect(await users.countDocuments({ email: address })).toBe(1);
    expect(
      await connection
        .db!.collection('auditEvents')
        .countDocuments({ subjectUserId: user!._id }),
    ).toBe(1);
  });

  it('uses Secure/HttpOnly host cookies and origin/CSRF checks without returning browser credentials', async () => {
    const csrf = await api().get('/auth/csrf').set(browser).expect(200);
    const csrfCookie = cookies(csrf);
    const address = email();
    await api()
      .post('/auth/signup')
      .set(browser)
      .send({ email: address, name: 'Browser Test', password })
      .expect(403);
    const result = await api()
      .post('/auth/signup')
      .set(browser)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ email: address, name: 'Browser Test', password })
      .expect(201);
    expect(result.body).not.toHaveProperty('accessToken');
    expect(result.body).not.toHaveProperty('refreshToken');
    for (const value of result.headers['set-cookie'] as unknown as string[]) {
      expect(value).toContain('Secure');
      expect(value).toContain('HttpOnly');
      expect(value).toContain('SameSite=Strict');
      expect(value).toContain('Path=/');
      expect(value).not.toContain('Domain=');
    }
    const cookie = `${csrfCookie}; ${cookies(result)}`;
    await api().get('/auth/me').set(browser).set('Cookie', cookie).expect(200);
    await api()
      .post('/auth/refresh')
      .set(browser)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'X'.repeat(43))
      .send({})
      .expect(403);
    await api()
      .post('/auth/refresh')
      .set(browser)
      .set('Origin', 'https://malicious.invalid')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({})
      .expect(403);
    const next = await api()
      .post('/auth/refresh')
      .set(browser)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({})
      .expect(200);
    const nextCookie = `${csrfCookie}; ${cookies(next)}`;
    await api()
      .post('/auth/logout')
      .set(browser)
      .set('Cookie', nextCookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({})
      .expect(200);
    await api()
      .get('/auth/me')
      .set(browser)
      .set('Cookie', nextCookie)
      .expect(401);
  });

  it('does not expose private content endpoints or create forbidden collections', async () => {
    await api()
      .post('/uploads/videos')
      .send({ marker: 'synthetic-private-marker' })
      .expect(404);
    const collections = await connection
      .db!.listCollections({}, { nameOnly: true })
      .toArray();
    expect(
      collections.map(({ name: collection }) => collection).sort(),
    ).toEqual(['auditEvents', 'authAttempts', 'authSessions', 'users']);
  });
});
