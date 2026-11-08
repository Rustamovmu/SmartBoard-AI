import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
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
import { DeviceSchemaService } from '../src/modules/device-enrollment/device-schema.service';
import { DEVICE_POLICY } from '../src/modules/device-enrollment/device-enrollment.service';
import { MembersService } from '../src/modules/members/members.service';
import {
  assertExactTestDatabase,
  assertInitiallyEmpty,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

const fields = 'id userId label platform status createdAt revokedAt';
const startQuery =
  'mutation($input: CreateDevicePairingInput!) { createDevicePairing(input: $input) { code expiresAt } }';
const confirmQuery = `mutation($input: ConfirmDevicePairingInput!) { confirmDevicePairing(input: $input) { ${fields} } }`;
const mineQuery = `query($input: DevicesInput!) { myDevices(input: $input) { items { ${fields} } page pageSize total } }`;
const adminQuery = `query($input: AdminDevicesInput!) { adminDevices(input: $input) { items { ${fields} } page pageSize total } }`;
const currentQuery = `query { currentDevice { ${fields} } }`;
const revokeQuery = `mutation($input: RevokeDeviceInput!) { revokeDevice(input: $input) { ${fields} } }`;
const adminRevokeQuery = `mutation($input: RevokeDeviceInput!) { adminRevokeDevice(input: $input) { ${fields} } }`;
const revokeBatchQuery = `mutation($input: RevokeDevicesInput!) { revokeDevices(input: $input) { items { ${fields} } page pageSize total } }`;
const adminRevokeBatchQuery = `mutation($input: RevokeDevicesInput!) { adminRevokeDevices(input: $input) { items { ${fields} } page pageSize total } }`;

describe('device enrollment with guarded disposable MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let name: string;
  let owned = false;
  let passwordHash: string;
  const password = 'synthetic-device-integration-password';
  const native = { 'X-SmartBord-Client': 'native' };
  const api = () => request(app.getHttpServer());
  const gql = (token: string, query: string, input?: object) =>
    api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables: { input } });
  const error = (response: request.Response) =>
    response.body.errors?.[0]?.extensions.code;
  const login = (email: string) =>
    api().post('/auth/login').set(native).send({ email, password });
  const refresh = (refreshToken: string) =>
    api().post('/auth/refresh').set(native).send({ refreshToken });
  const fixture = async (role: 'USER' | 'ADMIN' = 'USER') => {
    const email = `synthetic-${randomUUID()}@example.test`;
    const member = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      return app
        .get(MembersService)
        .create(
          { email, name: 'Synthetic Device Owner', passwordHash },
          role,
          session,
        );
    });
    const target = (await login(email).expect(200)).body as {
      accessToken: string;
      refreshToken: string;
    };
    const approver = (await login(email).expect(200)).body as {
      accessToken: string;
      refreshToken: string;
    };
    return { id: member._id, email, target, approver };
  };
  const start = (
    token: string,
    input: object = { label: 'Synthetic Phone', platform: 'ANDROID' },
  ) => gql(token, startQuery, input);
  const confirm = (token: string, code: string) =>
    gql(token, confirmQuery, { code });
  const enroll = async (owner: Awaited<ReturnType<typeof fixture>>) => {
    const started = await start(owner.target.accessToken).expect(200);
    const code: string = started.body.data.createDevicePairing.code;
    const confirmed = await confirm(owner.approver.accessToken, code).expect(
      200,
    );
    expect(confirmed.body.errors).toBeUndefined();
    return {
      code,
      device: confirmed.body.data.confirmDevicePairing as {
        id: string;
        userId: string;
        status: string;
      },
    };
  };
  const enrollAnother = async (owner: Awaited<ReturnType<typeof fixture>>) => {
    const target = (await login(owner.email).expect(200))
      .body as typeof owner.target;
    return { target, ...(await enroll({ ...owner, target })) };
  };

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

  it('stores only a hash, binds the native session atomically, and preserves binding on refresh', async () => {
    const owner = await fixture();
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice,
    ).toBeNull();
    const started = await start(owner.target.accessToken)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const pairing = started.body.data.createDevicePairing;
    expect(pairing.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(pairing.expiresAt) - Date.now()).toBeLessThanOrEqual(
      DEVICE_POLICY.pairingLifetimeMs,
    );
    const stored = await connection
      .db!.collection('pairingRequests')
      .findOne({ userId: owner.id });
    expect(stored!.codeHash).toBe(digest(pairing.code));
    expect(JSON.stringify(stored)).not.toContain(pairing.code);
    const approved = await confirm(owner.approver.accessToken, pairing.code);
    const device = approved.body.data.confirmDevicePairing;
    expect(device).toMatchObject({
      userId: owner.id,
      platform: 'ANDROID',
      status: 'ACTIVE',
      revokedAt: null,
    });
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice.id,
    ).toBe(device.id);
    expect(
      (await gql(owner.approver.accessToken, currentQuery)).body.data
        .currentDevice,
    ).toBeNull();
    const rotated = await refresh(owner.target.refreshToken).expect(200);
    expect(
      (await gql(rotated.body.accessToken, currentQuery)).body.data
        .currentDevice.id,
    ).toBe(device.id);
    expect(
      (await gql(owner.approver.accessToken, mineQuery, {})).body.data
        .myDevices,
    ).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    const event = await connection
      .db!.collection('auditEvents')
      .findOne({ action: 'DEVICE_ENROLLED' });
    expect(event).toMatchObject({
      actorType: 'USER',
      actorUserId: owner.id,
      subjectUserId: owner.id,
      subjectDeviceId: device.id,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /Synthetic Phone|codeHash|Token|code|label/,
    );
  });

  it('rejects self approval, foreign owners (including admins), replay and superseded codes', async () => {
    const owner = await fixture();
    const foreign = await fixture('ADMIN');
    const first = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    const second = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    expect(error(await confirm(owner.approver.accessToken, first))).toBe(
      'NOT_FOUND',
    );
    expect(error(await confirm(owner.target.accessToken, second))).toBe(
      'FORBIDDEN',
    );
    expect(error(await confirm(foreign.approver.accessToken, second))).toBe(
      'NOT_FOUND',
    );
    expect(
      (await confirm(owner.approver.accessToken, second)).body.data
        .confirmDevicePairing.status,
    ).toBe('ACTIVE');
    expect(error(await confirm(owner.approver.accessToken, second))).toBe(
      'NOT_FOUND',
    );
    expect(error(await start(owner.target.accessToken))).toBe('CONFLICT');
    expect(await connection.db!.collection('devices').countDocuments()).toBe(1);
  });

  it('checks expiry without TTL deletion and refuses logged-out or version-revoked target sessions', async () => {
    const owner = await fixture();
    const first = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    assertExactTestDatabase(connection, name);
    await connection
      .db!.collection('pairingRequests')
      .updateOne({ userId: owner.id }, { $set: { expiresAt: new Date(0) } });
    expect(error(await confirm(owner.approver.accessToken, first))).toBe(
      'NOT_FOUND',
    );
    const second = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    await api()
      .post('/auth/logout')
      .set(native)
      .send({ refreshToken: owner.target.refreshToken })
      .expect(200);
    expect(error(await confirm(owner.approver.accessToken, second))).toBe(
      'CONFLICT',
    );
    expect(await connection.db!.collection('devices').countDocuments()).toBe(0);
  });

  it('approves exactly once under concurrent confirmation', async () => {
    const owner = await fixture();
    const code = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    const results = await Promise.all([
      confirm(owner.approver.accessToken, code),
      confirm(owner.approver.accessToken, code),
    ]);
    expect(
      results.filter((r) => r.body.data?.confirmDevicePairing),
    ).toHaveLength(1);
    expect(results.map(error)).toContain('NOT_FOUND');
    expect(await connection.db!.collection('devices').countDocuments()).toBe(1);
    expect(
      await connection.db!.collection('auditEvents').countDocuments(),
    ).toBe(1);
  });

  it('scopes lists/revocation to the owner and restricts admin operations', async () => {
    const owner = await fixture();
    const foreign = await fixture();
    const admin = await fixture('ADMIN');
    const { device } = await enroll(owner);
    expect(
      (await gql(foreign.approver.accessToken, mineQuery, {})).body.data
        .myDevices.total,
    ).toBe(0);
    expect(
      error(
        await gql(foreign.approver.accessToken, revokeQuery, { id: device.id }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      error(
        await gql(foreign.approver.accessToken, adminQuery, {
          userId: owner.id,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      error(
        await gql(foreign.approver.accessToken, adminRevokeQuery, {
          id: device.id,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      (
        await gql(admin.approver.accessToken, adminQuery, {
          userId: owner.id,
          pageSize: 1,
          status: 'ACTIVE',
        })
      ).body.data.adminDevices,
    ).toMatchObject({ total: 1, pageSize: 1, items: [{ id: device.id }] });
    const revoked = await gql(admin.approver.accessToken, adminRevokeQuery, {
      id: device.id,
    });
    expect(revoked.body.data.adminRevokeDevice.status).toBe('REVOKED');
    expect(
      await connection
        .db!.collection('auditEvents')
        .findOne({ action: 'DEVICE_REVOKED' }),
    ).toMatchObject({
      actorType: 'ADMIN',
      actorUserId: admin.id,
      subjectUserId: owner.id,
    });
  });

  it('revokes access/refresh without revoking unrelated sessions and makes repeated revocation a no-op', async () => {
    const owner = await fixture();
    const { device } = await enroll(owner);
    const first = await gql(owner.approver.accessToken, revokeQuery, {
      id: device.id,
    });
    expect(first.body.data.revokeDevice.status).toBe('REVOKED');
    await api()
      .get('/auth/me')
      .set(native)
      .set('Authorization', `Bearer ${owner.target.accessToken}`)
      .expect(401);
    await refresh(owner.target.refreshToken).expect(401);
    expect(
      (await gql(owner.approver.accessToken, currentQuery)).body.data
        .currentDevice,
    ).toBeNull();
    const repeated = await gql(owner.approver.accessToken, revokeQuery, {
      id: device.id,
    });
    expect(repeated.body.data.revokeDevice).toEqual(
      first.body.data.revokeDevice,
    );
    expect(
      await connection
        .db!.collection('auditEvents')
        .countDocuments({ action: 'DEVICE_REVOKED' }),
    ).toBe(1);
    const fresh = await login(owner.email).expect(200);
    expect(
      (await gql(fresh.body.accessToken, currentQuery)).body.data.currentDevice,
    ).toBeNull();
    const listed = await gql(owner.approver.accessToken, mineQuery, {
      status: 'REVOKED',
    });
    expect(listed.body.data.myDevices.total).toBe(1);
  });

  it('allows self revocation and rechecks device state even if a bound session was not explicitly revoked', async () => {
    const owner = await fixture();
    const { device } = await enroll(owner);
    assertExactTestDatabase(connection, name);
    await connection
      .db!.collection('devices')
      .updateOne(
        { userId: owner.id },
        { $set: { status: 'REVOKED', revokedAt: new Date() } },
      );
    await api()
      .get('/auth/me')
      .set(native)
      .set('Authorization', `Bearer ${owner.target.accessToken}`)
      .expect(401);
    await refresh(owner.target.refreshToken).expect(401);
    expect(
      (await gql(owner.approver.accessToken, mineQuery, {})).body.data.myDevices
        .items[0].id,
    ).toBe(device.id);
    const other = await fixture();
    const enrolled = await enroll(other);
    expect(
      (
        await gql(other.target.accessToken, revokeQuery, {
          id: enrolled.device.id,
        })
      ).body.data.revokeDevice.status,
    ).toBe('REVOKED');
    expect(
      error(await gql(other.target.accessToken, currentQuery).expect(401)),
    ).toBe('UNAUTHENTICATED');
  });

  it('rolls back pairing consumption, binding, and revocation when audit fails', async () => {
    const owner = await fixture();
    const code = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    const spy = jest
      .spyOn(app.get(AuditService), 'deviceChanged')
      .mockRejectedValueOnce(new Error('synthetic-private-marker'));
    try {
      const failed = await confirm(owner.approver.accessToken, code);
      expect(error(failed)).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(failed.body)).not.toContain(
        'synthetic-private-marker',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await connection.db!.collection('devices').countDocuments()).toBe(0);
    expect(
      (await connection
        .db!.collection('pairingRequests')
        .findOne({ userId: owner.id }))!.consumedAt,
    ).toBeNull();
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice,
    ).toBeNull();
    const device = (await confirm(owner.approver.accessToken, code)).body.data
      .confirmDevicePairing;
    const revokeSpy = jest
      .spyOn(app.get(AuditService), 'deviceChanged')
      .mockRejectedValueOnce(new Error('synthetic-private-marker'));
    try {
      expect(
        error(
          await gql(owner.approver.accessToken, revokeQuery, { id: device.id }),
        ),
      ).toBe('INTERNAL_ERROR');
    } finally {
      revokeSpy.mockRestore();
    }
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice.status,
    ).toBe('ACTIVE');
    await refresh(owner.target.refreshToken).expect(200);
  });

  it('serializes account blocking with approval and keeps blocked credentials unusable after reactivation', async () => {
    const owner = await fixture();
    const admin = await fixture('ADMIN');
    const code = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    const update =
      'mutation($input: UpdateAccountAccessInput!) { adminUpdateAccountAccess(input: $input) { id status } }';
    const results = await Promise.all([
      confirm(owner.approver.accessToken, code),
      gql(admin.approver.accessToken, update, {
        id: owner.id,
        status: 'BLOCKED',
      }),
    ]);
    expect(results[1].body.data.adminUpdateAccountAccess.status).toBe(
      'BLOCKED',
    );
    await refresh(owner.target.refreshToken).expect(401);
    await gql(owner.target.accessToken, currentQuery).expect(401);
    await gql(owner.approver.accessToken, currentQuery).expect(401);
    expect(
      (
        await gql(admin.approver.accessToken, update, {
          id: owner.id,
          status: 'ACTIVE',
        })
      ).body.data.adminUpdateAccountAccess.status,
    ).toBe('ACTIVE');
    await refresh(owner.target.refreshToken).expect(401);
    const fresh = await login(owner.email).expect(200);
    expect(error(await confirm(fresh.body.accessToken, code))).toBe(
      results[0].body.data?.confirmDevicePairing ? 'NOT_FOUND' : 'CONFLICT',
    );
  });

  it('serializes refresh with revocation so every returned credential is unusable afterward', async () => {
    const owner = await fixture();
    const { device } = await enroll(owner);
    const [rotated, revoked] = await Promise.all([
      refresh(owner.target.refreshToken),
      gql(owner.approver.accessToken, revokeQuery, { id: device.id }),
    ]);
    expect(revoked.body.data.revokeDevice.status).toBe('REVOKED');
    expect([200, 401]).toContain(rotated.status);
    if (rotated.status === 200) {
      await gql(rotated.body.accessToken, currentQuery).expect(401);
      await refresh(rotated.body.refreshToken).expect(401);
    }
    await refresh(owner.target.refreshToken).expect(401);
  });

  it('caps active enrollments atomically without consuming the rejected request', async () => {
    const owner = await fixture();
    assertExactTestDatabase(connection, name);
    await connection.db!.collection('devices').insertMany(
      Array.from({ length: DEVICE_POLICY.maximumActiveDevices - 1 }, () => ({
        _id: randomUUID() as never,
        userId: owner.id,
        label: 'Synthetic Fixture',
        platform: 'IOS',
        status: 'ACTIVE',
        createdAt: new Date(),
        revokedAt: null,
      })),
    );
    const another = (await login(owner.email).expect(200)).body;
    const first = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
    const second = (await start(another.accessToken)).body.data
      .createDevicePairing.code;
    const results = await Promise.all([
      confirm(owner.approver.accessToken, first),
      confirm(owner.approver.accessToken, second),
    ]);
    expect(
      results.filter((r) => r.body.data?.confirmDevicePairing),
    ).toHaveLength(1);
    expect(results.map(error)).toContain('CONFLICT');
    expect(
      await connection
        .db!.collection('devices')
        .countDocuments({ userId: owner.id, status: 'ACTIVE' }),
    ).toBe(DEVICE_POLICY.maximumActiveDevices);
    expect(
      await connection
        .db!.collection('pairingRequests')
        .countDocuments({ consumedAt: null }),
    ).toBe(1);
  });

  it('rejects unknown/private/operator/null inputs and enforces pagination bounds', async () => {
    const owner = await fixture();
    for (const input of [
      {
        label: 'Phone',
        platform: 'IOS',
        lectureTitle: 'synthetic-private-marker',
      },
      { label: '../private/path', platform: 'IOS' },
      { label: '', platform: 'IOS' },
      { label: 'Phone\nprivate', platform: 'IOS' },
      { label: 'Phone', platform: null },
    ]) {
      const response = await start(owner.target.accessToken, input);
      expect(error(response)).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain(
        'synthetic-private-marker',
      );
    }
    for (const input of [
      { page: 0 },
      { page: 10001 },
      { pageSize: 101 },
      { status: null },
      { userId: owner.id },
    ])
      expect(error(await gql(owner.target.accessToken, mineQuery, input))).toBe(
        'VALIDATION_ERROR',
      );
    for (const input of [
      { code: { $ne: null } },
      { code: null },
      { code: 'short' },
    ])
      expect(
        error(await gql(owner.approver.accessToken, confirmQuery, input)),
      ).toBe('VALIDATION_ERROR');
    expect(
      error(
        await gql(owner.approver.accessToken, revokeQuery, { id: 'invalid' }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(await connection.db!.collection('devices').countDocuments()).toBe(0);
  });

  it('enforces persistent account rate limits even on failed approvals', async () => {
    const owner = await fixture();
    const before = Math.floor(Date.now() / 60000);
    assertExactTestDatabase(connection, name);
    const counterIds = [before, before + 1].map((bucket) =>
      digest(`enrollment:confirm:${owner.id}:${bucket}`),
    );
    for (const id of counterIds)
      await connection
        .db!.collection('authAttempts')
        .updateOne(
          { _id: id as never },
          { $set: { count: 0, expiresAt: new Date(Date.now() + 180000) } },
          { upsert: true },
        );
    expect(
      error(await confirm(owner.approver.accessToken, 'x'.repeat(43))),
    ).toBe('NOT_FOUND');
    const counters = await connection
      .db!.collection('authAttempts')
      .find({
        _id: { $in: counterIds as never },
      })
      .toArray();
    expect(
      counters.reduce((total, counter) => total + Number(counter.count), 0),
    ).toBe(1);
    // Saturate adjacent buckets so the assertions are independent of a minute
    // rollover. Only these guarded disposable fixtures receive seeded counters.
    assertExactTestDatabase(connection, name);
    const saturate = async (scope: string, maximum: number) => {
      const bucket = Math.floor(Date.now() / 60000);
      for (const minute of [bucket, bucket + 1])
        await connection.db!.collection('authAttempts').updateOne(
          { _id: digest(`${scope}:${owner.id}:${minute}`) as never },
          {
            $set: {
              count: maximum,
              expiresAt: new Date(Date.now() + 180000),
            },
          },
          { upsert: true },
        );
    };
    await saturate('enrollment:confirm', 10);
    expect(
      error(await confirm(owner.approver.accessToken, 'x'.repeat(43))),
    ).toBe('RATE_LIMITED');
    expect(
      (await start(owner.target.accessToken)).body.data.createDevicePairing
        .code,
    ).toBeTruthy();
    await saturate('enrollment:create', 5);
    expect(error(await start(owner.target.accessToken))).toBe('RATE_LIMITED');
  });

  it('fails closed without required indexes and explicit preparation preserves enrollment data', async () => {
    const owner = await fixture();
    const { device } = await enroll(owner);
    await app.get(DeviceSchemaService).prepare();
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice.id,
    ).toBe(device.id);
    assertExactTestDatabase(connection, name);
    await connection
      .db!.collection('pairingRequests')
      .dropIndex('pairing_code_unique');
    try {
      expect(error(await gql(owner.approver.accessToken, mineQuery, {}))).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await app.get(DeviceSchemaService).prepare();
    }
    expect(
      (await gql(owner.target.accessToken, currentQuery)).body.data
        .currentDevice.id,
    ).toBe(device.id);
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

  it('requires browser CSRF for approval and disallows creating a native pairing from browser transport', async () => {
    const owner = await fixture();
    const code = (await start(owner.target.accessToken)).body.data
      .createDevicePairing.code;
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
    const browserGql = () =>
      api().post('/graphql').set(browser).set('Cookie', allCookies);
    const body = { query: confirmQuery, variables: { input: { code } } };
    expect(error(await browserGql().send(body).expect(403))).toBe('FORBIDDEN');
    expect(
      error(
        await browserGql()
          .set('Origin', 'https://malicious.invalid')
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send(body)
          .expect(403),
      ),
    ).toBe('FORBIDDEN');
    expect(
      error(
        await browserGql()
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send({
            query: startQuery,
            variables: { input: { label: 'Phone', platform: 'IOS' } },
          }),
      ),
    ).toBe('FORBIDDEN');
    const approved = await browserGql()
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(body)
      .expect(200);
    expect(approved.body.data.confirmDevicePairing.userId).toBe(owner.id);
    const revokeBody = {
      query: revokeBatchQuery,
      variables: {
        input: { ids: [approved.body.data.confirmDevicePairing.id] },
      },
    };
    expect(error(await browserGql().send(revokeBody).expect(403))).toBe(
      'FORBIDDEN',
    );
    expect(
      error(
        await browserGql()
          .set('Origin', 'https://malicious.invalid')
          .set('X-CSRF-Token', csrf.body.csrfToken)
          .send(revokeBody)
          .expect(403),
      ),
    ).toBe('FORBIDDEN');
    const revoked = await browserGql()
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send(revokeBody)
      .expect(200);
    expect(revoked.body.data.revokeDevices.items[0].status).toBe('REVOKED');
  });

  describe('atomic batches of selected device revocations', () => {
    it('revokes two owned devices in input order and preserves timestamps/audits on repeat', async () => {
      const owner = await fixture();
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const ids = [second.device.id, first.device.id];
      const result = await gql(owner.approver.accessToken, revokeBatchQuery, {
        ids,
      })
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(result.body.errors).toBeUndefined();
      const page = result.body.data.revokeDevices;
      expect(page).toMatchObject({ page: 1, pageSize: 2, total: 2 });
      expect(page.items.map((d: { id: string }) => d.id)).toEqual(ids);
      expect(
        page.items.every((d: { status: string }) => d.status === 'REVOKED'),
      ).toBe(true);
      expect(page.items[0].revokedAt).toBe(page.items[1].revokedAt);
      for (const target of [owner.target, second.target]) {
        await gql(target.accessToken, currentQuery).expect(401);
        await refresh(target.refreshToken).expect(401);
      }
      expect(
        (await gql(owner.approver.accessToken, currentQuery)).body.data
          .currentDevice,
      ).toBeNull();
      expect(
        (await gql(owner.approver.accessToken, revokeBatchQuery, { ids })).body
          .data.revokeDevices,
      ).toEqual(page);
      const events = await connection
        .db!.collection('auditEvents')
        .find({ action: 'DEVICE_REVOKED' })
        .toArray();
      expect(events).toHaveLength(2);
      expect(new Set(events.map((e) => e.subjectDeviceId))).toEqual(
        new Set(ids),
      );
      expect(JSON.stringify(events)).not.toMatch(
        /Synthetic Phone|codeHash|Token|label|password/,
      );
    });

    it('requires ADMIN for a cross-account batch and audits each actual owner', async () => {
      const firstOwner = await fixture();
      const secondOwner = await fixture();
      const admin = await fixture('ADMIN');
      const first = await enroll(firstOwner);
      const second = await enroll(secondOwner);
      const ids = [first.device.id, second.device.id];
      expect(
        error(
          await gql(firstOwner.approver.accessToken, adminRevokeBatchQuery, {
            ids,
          }),
        ),
      ).toBe('FORBIDDEN');
      const result = await gql(
        admin.approver.accessToken,
        adminRevokeBatchQuery,
        { ids },
      );
      expect(
        result.body.data.adminRevokeDevices.items.map(
          (d: { userId: string }) => d.userId,
        ),
      ).toEqual([firstOwner.id, secondOwner.id]);
      const events = await connection
        .db!.collection('auditEvents')
        .find({ action: 'DEVICE_REVOKED' })
        .toArray();
      expect(events).toHaveLength(2);
      for (const event of events)
        expect(event).toMatchObject({
          actorType: 'ADMIN',
          actorUserId: admin.id,
        });
      expect(new Set(events.map((e) => e.subjectUserId))).toEqual(
        new Set([firstOwner.id, secondOwner.id]),
      );
      await refresh(firstOwner.target.refreshToken).expect(401);
      await refresh(secondOwner.target.refreshToken).expect(401);
    });

    it('rejects a whole selection containing a missing or foreign device without ID disclosure or partial changes', async () => {
      const owner = await fixture();
      const foreign = await fixture();
      const ownDevice = await enroll(owner);
      const foreignDevice = await enroll(foreign);
      for (const id of [randomUUID(), foreignDevice.device.id]) {
        const response = await gql(
          owner.approver.accessToken,
          revokeBatchQuery,
          { ids: [ownDevice.device.id, id] },
        );
        expect(error(response)).toBe('NOT_FOUND');
        expect(JSON.stringify(response.body)).not.toContain(id);
        expect(JSON.stringify(response.body)).not.toContain(
          ownDevice.device.id,
        );
      }
      expect(
        await connection
          .db!.collection('devices')
          .countDocuments({ status: 'ACTIVE' }),
      ).toBe(2);
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(0);
      expect(
        (await gql(owner.target.accessToken, currentQuery)).body.data
          .currentDevice.status,
      ).toBe('ACTIVE');
      expect(
        (await gql(foreign.target.accessToken, currentQuery)).body.data
          .currentDevice.status,
      ).toBe('ACTIVE');
      // ADMIN authority changes ownership scope, never existence requirements.
      const admin = await fixture('ADMIN');
      expect(
        error(
          await gql(admin.approver.accessToken, adminRevokeBatchQuery, {
            ids: [ownDevice.device.id, randomUUID()],
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await connection
          .db!.collection('devices')
          .countDocuments({ status: 'ACTIVE' }),
      ).toBe(2);
    });

    it('rejects empty, oversized, duplicate, invalid, null and private batch inputs', async () => {
      const owner = await fixture();
      const { device } = await enroll(owner);
      for (const input of [
        { ids: [] },
        { ids: Array.from({ length: 21 }, () => randomUUID()) },
        { ids: [device.id, device.id] },
        { ids: ['invalid'] },
        { ids: null },
        { ids: [null] },
        { ids: [{ $ne: null }] },
        { ids: [device.id], userId: owner.id },
        { ids: [device.id], lectureTitle: 'synthetic-private-marker' },
      ]) {
        const response = await gql(
          owner.approver.accessToken,
          revokeBatchQuery,
          input,
        );
        expect(error(response)).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body)).not.toContain(
          'synthetic-private-marker',
        );
      }
      expect(
        (await gql(owner.target.accessToken, currentQuery)).body.data
          .currentDevice.status,
      ).toBe('ACTIVE');
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(0);
    });

    it('accepts exactly 20 selected devices and charges the shared single/batch revocation budget by ID', async () => {
      const owner = await fixture();
      const ids = Array.from({ length: 20 }, () => randomUUID());
      assertExactTestDatabase(connection, name);
      await connection.db!.collection('devices').insertMany(
        ids.map((id) => ({
          _id: id as never,
          userId: owner.id,
          label: 'Synthetic Batch Fixture',
          platform: 'IOS',
          status: 'ACTIVE',
          createdAt: new Date(),
          revokedAt: null,
        })),
      );
      const result = await gql(owner.approver.accessToken, revokeBatchQuery, {
        ids,
      });
      expect(result.body.data.revokeDevices).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 20,
      });
      expect(
        await connection
          .db!.collection('devices')
          .countDocuments({ status: 'REVOKED' }),
      ).toBe(20);
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(20);
      // Seed both adjacent buckets at the consumed value to keep rejection
      // deterministic even if the wall clock crosses a minute after the batch.
      const bucket = Math.floor(Date.now() / 60000);
      for (const minute of [bucket, bucket + 1])
        await connection
          .db!.collection('authAttempts')
          .updateOne(
            { _id: digest(`enrollment:revoke:${owner.id}:${minute}`) as never },
            { $set: { count: 20, expiresAt: new Date(Date.now() + 180000) } },
            { upsert: true },
          );
      expect(
        error(
          await gql(owner.approver.accessToken, revokeQuery, { id: ids[0] }),
        ),
      ).toBe('RATE_LIMITED');
      expect(
        error(
          await gql(owner.approver.accessToken, revokeBatchQuery, {
            ids: [ids[0]],
          }),
        ),
      ).toBe('RATE_LIMITED');
    });

    it('rolls back all devices, sessions and earlier audit writes when the second audit fails', async () => {
      const owner = await fixture();
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const ids = [first.device.id, second.device.id];
      const audit = app.get(AuditService);
      const original = audit.deviceChanged.bind(audit);
      let attempts = 0;
      const spy = jest
        .spyOn(audit, 'deviceChanged')
        .mockImplementation(async (...args) => {
          if (++attempts === 2) throw new Error('synthetic-private-marker');
          return original(...args);
        });
      try {
        const response = await gql(
          owner.approver.accessToken,
          revokeBatchQuery,
          { ids },
        );
        expect(error(response)).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(response.body)).not.toContain(
          'synthetic-private-marker',
        );
      } finally {
        spy.mockRestore();
      }
      expect(attempts).toBe(2);
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(0);
      expect(
        await connection
          .db!.collection('devices')
          .countDocuments({ status: 'ACTIVE' }),
      ).toBe(2);
      for (const target of [owner.target, second.target]) {
        expect(
          (await gql(target.accessToken, currentQuery)).body.data.currentDevice
            .status,
        ).toBe('ACTIVE');
        await refresh(target.refreshToken).expect(200);
      }
      expect(
        (await gql(owner.approver.accessToken, revokeBatchQuery, { ids })).body
          .data.revokeDevices.total,
      ).toBe(2);
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(2);
    });

    it('serializes overlapping batches and preserves the previously committed device timestamp', async () => {
      const owner = await fixture();
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const third = await enrollAnother(owner);
      const results = await Promise.all([
        gql(owner.approver.accessToken, revokeBatchQuery, {
          ids: [first.device.id, second.device.id],
        }),
        gql(owner.approver.accessToken, revokeBatchQuery, {
          ids: [second.device.id, third.device.id],
        }),
      ]);
      expect(
        results.map((response) => ({
          status: response.status,
          code: error(response),
          success: !!response.body.data?.revokeDevices,
        })),
      ).toEqual([
        { status: 200, code: undefined, success: true },
        { status: 200, code: undefined, success: true },
      ]);
      const timestamps = results.map(
        (r) =>
          r.body.data.revokeDevices.items.find(
            (d: { id: string }) => d.id === second.device.id,
          ).revokedAt,
      );
      expect(timestamps[0]).toBe(timestamps[1]);
      const events = await connection
        .db!.collection('auditEvents')
        .find({ action: 'DEVICE_REVOKED' })
        .toArray();
      expect(events).toHaveLength(3);
      expect(new Set(events.map((e) => e.subjectDeviceId)).size).toBe(3);
    });

    it('rejects a batch that would exceed the remaining weighted budget without changing any device', async () => {
      const owner = await fixture();
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const bucket = Math.floor(Date.now() / 60000);
      assertExactTestDatabase(connection, name);
      for (const minute of [bucket, bucket + 1])
        await connection
          .db!.collection('authAttempts')
          .updateOne(
            { _id: digest(`enrollment:revoke:${owner.id}:${minute}`) as never },
            { $set: { count: 19, expiresAt: new Date(Date.now() + 180000) } },
            { upsert: true },
          );
      expect(
        error(
          await gql(owner.approver.accessToken, revokeBatchQuery, {
            ids: [first.device.id, second.device.id],
          }),
        ),
      ).toBe('RATE_LIMITED');
      expect(
        await connection
          .db!.collection('devices')
          .countDocuments({ status: 'ACTIVE' }),
      ).toBe(2);
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(0);
      const single = await gql(owner.approver.accessToken, revokeQuery, {
        id: first.device.id,
      });
      expect(single.body.data.revokeDevice.status).toBe('REVOKED');
      expect(
        (await gql(second.target.accessToken, currentQuery)).body.data
          .currentDevice.status,
      ).toBe('ACTIVE');
    });

    it('rechecks admin authority against a concurrent demotion without a partially applied selection', async () => {
      const owner = await fixture();
      const actor = await fixture('ADMIN');
      const administrator = await fixture('ADMIN');
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const update =
        'mutation($input: UpdateAccountAccessInput!) { adminUpdateAccountAccess(input: $input) { id role } }';
      const [batch, demoted] = await Promise.all([
        gql(actor.approver.accessToken, adminRevokeBatchQuery, {
          ids: [first.device.id, second.device.id],
        }),
        gql(administrator.approver.accessToken, update, {
          id: actor.id,
          role: 'USER',
        }),
      ]);
      expect(demoted.body.data.adminUpdateAccountAccess.role).toBe('USER');
      const revoked = await connection
        .db!.collection('devices')
        .countDocuments({ status: 'REVOKED' });
      if (batch.body.data?.adminRevokeDevices) expect(revoked).toBe(2);
      else {
        expect(['UNAUTHENTICATED', 'FORBIDDEN']).toContain(error(batch));
        expect(revoked).toBe(0);
      }
      expect(
        await connection
          .db!.collection('auditEvents')
          .countDocuments({ action: 'DEVICE_REVOKED' }),
      ).toBe(revoked);
      await gql(actor.approver.accessToken, currentQuery).expect(401);
    });

    it('permits a batch containing the caller device and invalidates its credentials after success', async () => {
      const owner = await fixture();
      const first = await enroll(owner);
      const second = await enrollAnother(owner);
      const response = await gql(owner.target.accessToken, revokeBatchQuery, {
        ids: [first.device.id, second.device.id],
      });
      expect(response.body.data.revokeDevices.total).toBe(2);
      await gql(owner.target.accessToken, currentQuery).expect(401);
      await refresh(owner.target.refreshToken).expect(401);
      await gql(second.target.accessToken, currentQuery).expect(401);
      expect(
        (await gql(owner.approver.accessToken, currentQuery)).body.data
          .currentDevice,
      ).toBeNull();
    });
  });
});
