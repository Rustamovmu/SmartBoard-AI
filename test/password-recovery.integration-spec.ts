import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import {
  PasswordRecoveryService,
  PASSWORD_RECOVERY_LIFETIME_MS,
} from '../src/modules/auth/password-recovery.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { digest } from '../src/modules/auth/token.service';
import { DeviceEnrollmentService } from '../src/modules/device-enrollment/device-enrollment.service';
import { DeviceSchemaService } from '../src/modules/device-enrollment/device-schema.service';
import { DevicePlatform } from '../src/modules/device-enrollment/dto/device.dto';
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

describe('operator-assisted password recovery with disposable MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let users: Model<Member>;
  let name: string;
  let owned = false;
  let passwordHash: string;
  const password = 'synthetic-original-recovery-password';
  const newPassword = 'synthetic-new-recovery-password';
  const native = { 'X-SmartBord-Client': 'native' };
  const api = () => request(app.getHttpServer());
  const login = (email: string, value = password) =>
    api().post('/auth/login').set(native).send({ email, password: value });
  const me = (access: string) =>
    api().get('/auth/me').set(native).set('Authorization', `Bearer ${access}`);
  const reset = (recoveryToken: string, value = newPassword) =>
    api()
      .post('/auth/password/reset')
      .set(native)
      .send({ recoveryToken, password: value });
  const refresh = (refreshToken: string) =>
    api().post('/auth/refresh').set(native).send({ refreshToken });
  const recovery = () => app.get(PasswordRecoveryService);
  const countResets = () =>
    connection
      .db!.collection('auditEvents')
      .countDocuments({ action: 'PASSWORD_RESET' });
  const fixture = async (role: 'USER' | 'ADMIN' = 'USER') => {
    const email = `synthetic-${randomUUID()}@example.test`;
    const user = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create(
          { email, name: 'Synthetic Recovery Account', passwordHash },
          role,
          session,
        );
    });
    const first = (await login(email).expect(200)).body as {
      accessToken: string;
      refreshToken: string;
    };
    const second = (await login(email).expect(200)).body as typeof first;
    return { email, id: user._id, first, second };
  };
  const accountChange = (access: string, id: string, change: object) =>
    api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${access}`)
      .send({
        query:
          'mutation($input: UpdateAccountAccessInput!) { adminUpdateAccountAccess(input: $input) { id role status } }',
        variables: { input: { id, ...change } },
      });
  const runCli = (
    email: string,
    args = ['--private-output'],
    outputFd?: number,
  ) =>
    new Promise<{ code: number | null; secret: string; diagnostic: string }>(
      (resolve, reject) => {
        const child = spawn(
          'npm',
          ['run', '--silent', 'recovery:issue', '--', ...args],
          {
            env: { ...process.env, RECOVERY_ACCOUNT_EMAIL: email },
            stdio: ['ignore', outputFd ?? 'pipe', 'pipe'],
            timeout: 30000,
          },
        );
        let secret = '',
          diagnostic = '';
        child.stdout?.on('data', (chunk) => {
          secret += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
          diagnostic += String(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, secret, diagnostic }));
      },
    );

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
    await app.get(DeviceSchemaService).prepare();
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
      'devices',
      'pairingRequests',
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

  it('stores a hidden bounded hash, resets with Argon2id, revokes every session and preserves device inventory', async () => {
    const owner = await fixture();
    const pairing = await app
      .get(DeviceEnrollmentService)
      .createPairing(
        { label: 'Synthetic Recovery Phone', platform: DevicePlatform.ANDROID },
        owner.first.accessToken,
        'native',
      );
    const device = await app
      .get(DeviceEnrollmentService)
      .confirmPairing(pairing.code, owner.second.accessToken, 'native');
    const proof = await recovery().issue(owner.email);
    expect(/^sb_p\.[A-Za-z0-9_-]{43}$/.test(proof.recoveryToken)).toBe(true);
    expect(Date.parse(proof.expiresAt) - Date.now()).toBeLessThanOrEqual(
      PASSWORD_RECOVERY_LIFETIME_MS,
    );
    const stored = await users
      .findById(owner.id)
      .select(
        '+passwordRecoveryHash +passwordRecoveryExpiresAt +passwordRecoveryVersion',
      )
      .lean();
    expect(stored!.passwordRecoveryHash === digest(proof.recoveryToken)).toBe(
      true,
    );
    expect(stored!.passwordRecoveryVersion).toBe(0);
    expect(JSON.stringify(stored).includes(proof.recoveryToken)).toBe(false);
    expect(
      (await users.findById(owner.id).lean())!.passwordRecoveryHash,
    ).toBeUndefined();
    await me(owner.first.accessToken).expect(200); // Issuance changes no existing access.
    const result = await reset(proof.recoveryToken)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body).toEqual({ success: true });
    for (const grant of [owner.first, owner.second]) {
      await me(grant.accessToken).expect(401);
      await refresh(grant.refreshToken).expect(401);
    }
    await login(owner.email).expect(401);
    const signed = await login(owner.email, newPassword).expect(200);
    expect(signed.body.user).toMatchObject({ role: 'USER', status: 'ACTIVE' });
    expect(JSON.stringify(signed.body)).not.toMatch(
      /passwordRecovery|passwordHash|authVersion/,
    );
    const updated = await users
      .findById(owner.id)
      .select(
        '+passwordHash +authVersion +passwordRecoveryHash +passwordRecoveryExpiresAt +passwordRecoveryVersion',
      )
      .lean();
    expect(updated!.authVersion).toBe(1);
    expect(updated!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(
      await app.get(PasswordService).verify(newPassword, updated!.passwordHash),
    ).toBe(true);
    expect(updated!.passwordRecoveryHash).toBeUndefined();
    expect(updated!.passwordRecoveryExpiresAt).toBeUndefined();
    expect(updated!.passwordRecoveryVersion).toBeUndefined();
    expect(
      await connection
        .db!.collection('devices')
        .findOne({ _id: device.id as never }),
    ).toMatchObject({ status: 'ACTIVE', revokedAt: null });
    const events = await connection
      .db!.collection('auditEvents')
      .find({
        subjectUserId: owner.id,
        action: { $in: ['PASSWORD_RECOVERY_ISSUED', 'PASSWORD_RESET'] },
      })
      .toArray();
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'PASSWORD_RECOVERY_ISSUED',
          actorType: 'LOCAL_COMMAND',
        }),
        expect.objectContaining({
          action: 'PASSWORD_RESET',
          actorType: 'RECOVERY_CREDENTIAL',
        }),
      ]),
    );
    expect(JSON.stringify(events).includes(proof.recoveryToken)).toBe(false);
    expect(JSON.stringify(events).includes(newPassword)).toBe(false);
  });

  it('supersedes the previous proof and rejects used proofs without another password change', async () => {
    const owner = await fixture();
    const first = await recovery().issue(owner.email);
    const second = await recovery().issue(owner.email);
    await reset(first.recoveryToken).expect(401);
    await me(owner.first.accessToken).expect(200);
    await reset(second.recoveryToken).expect(200);
    await reset(
      second.recoveryToken,
      'synthetic-unwanted-replay-password',
    ).expect(401);
    expect(await countResets()).toBe(1);
    await login(owner.email, newPassword).expect(200);
  });

  it('enforces expiry without a TTL index on users and makes unknown/expired proofs indistinguishable', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    assertExactTestDatabase(connection, name);
    await users.updateOne(
      { _id: owner.id },
      { $set: { passwordRecoveryExpiresAt: new Date(0) } },
    );
    const expired = await reset(proof.recoveryToken).expect(401);
    const unknown = await reset(
      `sb_p.${randomBytes(32).toString('base64url')}`,
    ).expect(401);
    expect(expired.body).toEqual(unknown.body);
    expect(
      (await users.listIndexes()).some(
        (index) => index.expireAfterSeconds !== undefined,
      ),
    ).toBe(false);
    expect(await users.countDocuments({ _id: owner.id })).toBe(1);
    await me(owner.first.accessToken).expect(200);
    expect(await countResets()).toBe(0);
  });

  it('allows exactly one concurrent consumer and only the winning password works', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    const choices = [newPassword, 'synthetic-second-concurrent-password'];
    const results = await Promise.all(
      choices.map((value) => reset(proof.recoveryToken, value)),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    const winner = results.findIndex((r) => r.status === 200);
    await login(owner.email, choices[winner]).expect(200);
    await login(owner.email, choices[1 - winner]).expect(401);
    expect(await countResets()).toBe(1);
    expect(
      (await users.findById(owner.id).select('+authVersion').lean())!
        .authVersion,
    ).toBe(1);
  });

  it('rolls back replacement issuance when its audit fails, preserving the prior usable proof', async () => {
    const owner = await fixture();
    const old = await recovery().issue(owner.email);
    const spy = jest
      .spyOn(app.get(AuditService), 'passwordRecovery')
      .mockRejectedValueOnce(new Error('synthetic-private-marker'));
    try {
      await expect(recovery().issue(owner.email)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(
      (await users.findById(owner.id).select('+passwordRecoveryHash').lean())!
        .passwordRecoveryHash === digest(old.recoveryToken),
    ).toBe(true);
    await reset(old.recoveryToken).expect(200);
    expect(
      await connection
        .db!.collection('auditEvents')
        .countDocuments({ action: 'PASSWORD_RECOVERY_ISSUED' }),
    ).toBe(1);
  });

  it('rolls back proof consumption, password, auth version, sessions and audit on reset audit failure', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    const spy = jest
      .spyOn(app.get(AuditService), 'passwordRecovery')
      .mockRejectedValueOnce(new Error('synthetic-private-marker'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const response = await reset(proof.recoveryToken).expect(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain(
        'synthetic-private-marker',
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'synthetic-private-marker',
      );
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    const stored = await users
      .findById(owner.id)
      .select('+authVersion +passwordRecoveryHash +passwordHash')
      .lean();
    expect(stored!.authVersion).toBe(0);
    expect(stored!.passwordHash === passwordHash).toBe(true);
    expect(stored!.passwordRecoveryHash === digest(proof.recoveryToken)).toBe(
      true,
    );
    await me(owner.first.accessToken).expect(200);
    await me(owner.second.accessToken).expect(200);
    expect(await countResets()).toBe(0);
    await reset(proof.recoveryToken).expect(200);
    expect(await countResets()).toBe(1);
  });

  it.each(['BLOCKED', 'DELETED'])(
    'cannot issue or consume a proof for %s, or revive one after reactivation',
    async (status) => {
      const admin = await fixture('ADMIN');
      const owner = await fixture();
      const proof = await recovery().issue(owner.email);
      const changed = await accountChange(admin.first.accessToken, owner.id, {
        status,
      });
      expect(changed.body.data.adminUpdateAccountAccess.status).toBe(status);
      await expect(recovery().issue(owner.email)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await reset(proof.recoveryToken).expect(401);
      await accountChange(admin.first.accessToken, owner.id, {
        status: 'ACTIVE',
      });
      await reset(proof.recoveryToken).expect(401);
      const replacement = await recovery().issue(owner.email);
      await reset(replacement.recoveryToken).expect(200);
      expect((await users.findById(owner.id).lean())!.status).toBe('ACTIVE');
    },
  );

  it('invalidates proofs on role changes while recovery preserves the current administrator role', async () => {
    const admin = await fixture('ADMIN');
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    expect(
      (
        await accountChange(admin.first.accessToken, owner.id, {
          role: 'ADMIN',
        })
      ).body.data.adminUpdateAccountAccess.role,
    ).toBe('ADMIN');
    await reset(proof.recoveryToken).expect(401);
    const replacement = await recovery().issue(owner.email);
    await reset(replacement.recoveryToken).expect(200);
    expect((await users.findById(owner.id).lean())!.role).toBe('ADMIN');
  });

  it('rechecks current account/proof state after password hashing', async () => {
    const admin = await fixture('ADMIN');
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    let ready!: () => void, release!: () => void;
    const hashing = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = app
      .get(PasswordService)
      .hash.bind(app.get(PasswordService));
    const spy = jest
      .spyOn(app.get(PasswordService), 'hash')
      .mockImplementationOnce(async (value) => {
        ready();
        await resume;
        return original(value);
      });
    const pending = reset(proof.recoveryToken).then((result) => result);
    try {
      await hashing;
      expect(
        (
          await accountChange(admin.first.accessToken, owner.id, {
            status: 'BLOCKED',
          })
        ).body.data.adminUpdateAccountAccess.status,
      ).toBe('BLOCKED');
      release();
      expect((await pending).status).toBe(401);
    } finally {
      release();
      spy.mockRestore();
    }
    expect(await countResets()).toBe(0);
    expect(
      (await users.findById(owner.id).select('+passwordHash').lean())!
        .passwordHash === passwordHash,
    ).toBe(true);
  });

  it('serializes replacement issuance with reset so the newly issued proof is the only remaining usable proof', async () => {
    const owner = await fixture();
    const old = await recovery().issue(owner.email);
    const [replacement, result] = await Promise.all([
      recovery().issue(owner.email),
      reset(old.recoveryToken),
    ]);
    expect([200, 401]).toContain(result.status);
    await reset(old.recoveryToken).expect(401);
    await reset(replacement.recoveryToken).expect(200);
    expect(await countResets()).toBe(result.status === 200 ? 2 : 1);
  });

  it('rejects invalid/private/operator inputs without consuming a valid proof', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    for (const input of [
      { recoveryToken: proof.recoveryToken, password: 'short' },
      { recoveryToken: proof.recoveryToken, password: 'x'.repeat(129) },
      { recoveryToken: null, password: newPassword },
      { recoveryToken: { $ne: null }, password: newPassword },
      { recoveryToken: 'invalid', password: newPassword },
      { recoveryToken: proof.recoveryToken, password: null },
      {
        recoveryToken: proof.recoveryToken,
        password: newPassword,
        role: 'ADMIN',
        status: 'ACTIVE',
        lectureTitle: 'synthetic-private-marker',
      },
    ]) {
      const rejected = await api()
        .post('/auth/password/reset')
        .set(native)
        .send(input)
        .expect(400);
      expect(rejected.body.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(rejected.body)).not.toContain(
        'synthetic-private-marker',
      );
      expect(JSON.stringify(rejected.body).includes(proof.recoveryToken)).toBe(
        false,
      );
    }
    await reset(proof.recoveryToken).expect(200);
  });

  it('rate-limits reset IPs and hashed proofs before password hashing', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    const bucket = Math.floor(Date.now() / 60000);
    assertExactTestDatabase(connection, name);
    for (const minute of [bucket, bucket + 1])
      await connection.db!.collection('authAttempts').updateOne(
        {
          _id: digest(
            `recovery:proof:${digest(proof.recoveryToken)}:${minute}`,
          ) as never,
        },
        { $set: { count: 5, expiresAt: new Date(Date.now() + 180000) } },
        { upsert: true },
      );
    const spy = jest.spyOn(app.get(PasswordService), 'hash');
    try {
      expect((await reset(proof.recoveryToken).expect(429)).body.code).toBe(
        'RATE_LIMITED',
      );
      expect(spy).not.toHaveBeenCalled();
      for (const minute of [bucket, bucket + 1])
        await connection.db!.collection('authAttempts').updateOne(
          {
            _id: digest(`auth:resetPassword:ip:127.0.0.1:${minute}`) as never,
          },
          { $set: { count: 10, expiresAt: new Date(Date.now() + 180000) } },
          { upsert: true },
        );
      expect(
        (
          await reset(`sb_p.${randomBytes(32).toString('base64url')}`).expect(
            429,
          )
        ).body.code,
      ).toBe('RATE_LIMITED');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await countResets()).toBe(0);
  });

  it('requires explicit recovery index setup without disabling normal authentication, preserving existing proofs on prepare', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    assertExactTestDatabase(connection, name);
    await users.collection.dropIndex('unique_password_recovery_hash');
    try {
      await reset(proof.recoveryToken).expect(503);
      await expect(recovery().issue(owner.email)).rejects.toThrow();
      await me(owner.first.accessToken).expect(200);
    } finally {
      await app.get(AuthSchemaService).prepare();
    }
    expect(
      (await users.findById(owner.id).select('+passwordRecoveryHash').lean())!
        .passwordRecoveryHash === digest(proof.recoveryToken),
    ).toBe(true);
    await reset(proof.recoveryToken).expect(200);
  });

  it('runs the explicit npm CLI through a private pipe, recovers the last admin, and rejects ordinary/file output', async () => {
    const owner = await fixture('ADMIN');
    const denied = await runCli(owner.email, []);
    expect(denied.code).toBe(1);
    expect(denied.secret.length).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'sbt-recovery-output-'));
    const output = join(dir, 'empty-output');
    const fd = openSync(output, 'wx', 0o600);
    try {
      const rejected = await runCli(owner.email, ['--private-output'], fd);
      expect(rejected.code).toBe(1);
      expect(readFileSync(output).length).toBe(0);
    } finally {
      closeSync(fd);
      unlinkSync(output);
      rmdirSync(dir);
    }
    expect(
      await connection
        .db!.collection('auditEvents')
        .countDocuments({ action: 'PASSWORD_RECOVERY_ISSUED' }),
    ).toBe(0);
    const issued = await runCli(`  ${owner.email.toUpperCase()}  `);
    expect(issued.code).toBe(0);
    const proof = JSON.parse(issued.secret) as {
      recoveryToken: string;
      expiresAt: string;
    };
    expect(/^sb_p\.[A-Za-z0-9_-]{43}$/.test(proof.recoveryToken)).toBe(true);
    expect(issued.diagnostic.includes(proof.recoveryToken)).toBe(false);
    await reset(proof.recoveryToken).expect(200);
    const signed = await login(owner.email, newPassword).expect(200);
    expect(signed.body.user.role).toBe('ADMIN');
    expect(
      await users.countDocuments({ role: 'ADMIN', status: 'ACTIVE' }),
    ).toBe(1);
  });

  it('enforces browser origin/CSRF, clears cookies after reset, and never auto-signs in', async () => {
    const owner = await fixture();
    const proof = await recovery().issue(owner.email);
    const browser = {
      'X-SmartBord-Client': 'browser',
      Origin: 'https://localhost:3000',
    };
    const csrf = await api().get('/auth/csrf').set(browser).expect(200);
    const cookie = (csrf.headers['set-cookie'] as unknown as string[])[0].split(
      ';',
    )[0];
    const signed = await api()
      .post('/auth/login')
      .set(browser)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ email: owner.email, password })
      .expect(200);
    const allCookies = [
      cookie,
      ...(signed.headers['set-cookie'] as unknown as string[]).map(
        (c) => c.split(';')[0],
      ),
    ].join('; ');
    const body = { recoveryToken: proof.recoveryToken, password: newPassword };
    const call = () =>
      api().post('/auth/password/reset').set(browser).set('Cookie', allCookies);
    await call().send(body).expect(403);
    await call()
      .set('Origin', 'https://malicious.invalid')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(body)
      .expect(403);
    const resetResult = await call()
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(body)
      .expect(200);
    expect(resetResult.body).toEqual({ success: true });
    const cleared = resetResult.headers['set-cookie'] as unknown as string[];
    expect(cleared).toHaveLength(3);
    expect(
      cleared.every(
        (c) =>
          c.includes('Secure') &&
          c.includes('HttpOnly') &&
          c.includes('SameSite=Strict') &&
          c.includes('Expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
    await api()
      .get('/auth/me')
      .set(browser)
      .set('Cookie', allCookies)
      .expect(401);
    await me(owner.first.accessToken).expect(401);
  });

  it('provides no public proof issuer, media path or secret GraphQL field', async () => {
    const owner = await fixture();
    await recovery().issue(owner.email);
    await api().get('/__test/recovery-proof').expect(404);
    for (const path of [
      '/auth/password/forgot',
      '/auth/password/recovery',
      '/auth/recovery/issue',
    ])
      await api()
        .post(path)
        .set(native)
        .set('Authorization', `Bearer ${owner.first.accessToken}`)
        .send({ email: owner.email })
        .expect(404);
    const rejected = await api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${owner.first.accessToken}`)
      .send({ query: 'query { currentAccount { id passwordRecoveryHash } }' })
      .expect(400);
    expect(JSON.stringify(rejected.body)).not.toContain('passwordRecoveryHash');
    expect(
      (await connection.db!.listCollections({}, { nameOnly: true }).toArray())
        .map((c) => c.name)
        .sort(),
    ).toEqual([
      'auditEvents',
      'authAttempts',
      'authSessions',
      'devices',
      'pairingRequests',
      'platformSettings',
      'users',
    ]);
  });
});
