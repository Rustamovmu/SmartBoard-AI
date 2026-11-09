import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { DatabaseService } from '../src/database/database.service';
import { DevicePlatform } from '../src/modules/device-enrollment/dto/device.dto';
import {
  AccountRole,
  AccountState,
} from '../src/modules/admin/dto/account.dto';
import { AnalysisConfig } from '../src/modules/analysis-access/analysis.config';
import { AnalysisIdentityService } from '../src/modules/analysis-access/analysis-identity.service';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { PasswordRecoveryService } from '../src/modules/auth/password-recovery.service';
import { digest } from '../src/modules/auth/token.service';
import { DeviceSchemaService } from '../src/modules/device-enrollment/device-schema.service';
import { DeviceEnrollmentService } from '../src/modules/device-enrollment/device-enrollment.service';
import { MembersService } from '../src/modules/members/members.service';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuditService } from '../src/modules/audit/audit.service';
import type { AnalysisGrant } from '../src/contracts/analysis-transport-v1';
import {
  assertExactTestDatabase,
  assertInitiallyEmpty,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

interface Wire {
  type: string;
  streamId: string;
  code?: string;
  capabilities?: object;
}
interface Client {
  ws: WebSocket;
  messages: Wire[];
  closed: Promise<number>;
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('native connection foundation with real sockets and disposable MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let name: string;
  let owned = false;
  let base: string;
  let passwordHash: string;
  const config = { enabled: true };
  const clients: Client[] = [];
  const native = { 'X-SmartBord-Client': 'native' };
  const api = () => request(app.getHttpServer());
  const access = (token: string, body: unknown = {}) =>
    api()
      .post('/analysis/access')
      .set(native)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  const grant = async (token: string): Promise<AnalysisGrant> =>
    (await access(token).expect(201).expect('Cache-Control', 'no-store')).body;
  const command = (client: Client, type = 'heartbeat', extra = {}) =>
    client.ws.send(
      JSON.stringify({
        protocolVersion: 1,
        streamId: client.messages[0].streamId,
        type,
        ...extra,
      }),
    );
  const waitStatus = async (client: Client) => {
    const deadline = Date.now() + 2_000;
    while (
      !client.messages.some((m) => m.type === 'status') &&
      Date.now() < deadline
    )
      await delay(10);
    expect(client.messages.find((m) => m.type === 'status')).toMatchObject({
      capabilities: { vision: false, acceptsFrames: false },
      code: 'VISION_UNAVAILABLE',
    });
  };
  const open = (
    ticket: string,
    endpoint = 'analyze',
    headers: Record<string, string | string[]> = {},
    suffix = '',
  ) =>
    new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(`${base}/ws/${endpoint}${suffix}`, {
        headers: { ...native, Authorization: `Bearer ${ticket}`, ...headers },
        perMessageDeflate: true,
      });
      const client: Client = {
        ws,
        messages: [],
        closed: new Promise((done) => ws.once('close', (code) => done(code))),
      };
      clients.push(client);
      ws.on('error', () => undefined);
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        ws.terminate();
      });
      ws.once('close', () => reject(new Error('Closed before ready')));
      ws.on('message', (raw) => {
        const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw);
        const message = JSON.parse(bytes.toString('utf8')) as Wire;
        client.messages.push(message);
        if (message.type === 'ready') resolve(client);
      });
    });

  const fixture = async (role: 'USER' | 'ADMIN' = 'USER', pair = true) => {
    const result = await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      const user = await app.get(MembersService).create(
        {
          email: `synthetic-${randomUUID()}@example.test`,
          name: 'Synthetic Stream Owner',
          passwordHash,
        },
        role,
        session,
      );
      const target = await app
        .get(AuthSessionService)
        .create(user, 'native', session);
      const approver = await app
        .get(AuthSessionService)
        .create(user, 'native', session);
      return { user, target, approver };
    });
    let deviceId = '';
    if (pair) {
      const pairing = await app
        .get(DeviceEnrollmentService)
        .createPairing(
          { label: 'Synthetic Phone', platform: DevicePlatform.ANDROID },
          result.target.accessToken,
          'native',
        );
      deviceId = (
        await app
          .get(DeviceEnrollmentService)
          .confirmPairing(pairing.code, result.approver.accessToken, 'native')
      ).id;
    }
    return { ...result, deviceId };
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
      // The fixture owns this external connection through final identity-guarded cleanup.
      .overrideProvider(DatabaseService)
      .useValue({ onApplicationShutdown: () => undefined })
      .overrideProvider(AnalysisConfig)
      .useValue(config)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(DeviceSchemaService).prepare();
    passwordHash = await app
      .get(PasswordService)
      .hash('synthetic-analysis-password');
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('http:', 'ws:');
  });
  beforeEach(async () => {
    config.enabled = true;
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
    // Prior pending grants are invalidated by the same database checks as revocation.
    await delay(1_100);
  });
  afterEach(async () => {
    for (const client of clients) client.ws.terminate();
    await Promise.all(clients.map((c) => c.closed));
    clients.length = 0;
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      try {
        if (owned) await dropOwnedTestDatabase(connection, name);
      } finally {
        if (connection?.readyState) await connection.close();
      }
    }
  });

  it('issues no cookies and supports either connection order, status, heartbeat and close', async () => {
    for (const first of ['analyze', 'control'] as const) {
      const owner = await fixture();
      const response = await access(owner.target.accessToken).expect(201);
      expect(response.headers['set-cookie']).toBeUndefined();
      const issued = response.body as AnalysisGrant;
      expect(issued).toMatchObject({
        protocolVersion: 1,
        capabilities: { vision: false, acceptsFrames: false },
      });
      expect(issued.analyzeTicket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.controlTicket).not.toBe(issued.analyzeTicket);
      const second = first === 'analyze' ? 'control' : 'analyze';
      const one = await open(
        first === 'analyze' ? issued.analyzeTicket : issued.controlTicket,
        first,
      );
      const two = await open(
        second === 'analyze' ? issued.analyzeTicket : issued.controlTicket,
        second,
      );
      expect(one.ws.extensions).toBe('');
      command(one);
      command(two, 'status');
      await Promise.all([waitStatus(one), waitStatus(two)]);
      command(one, 'close');
      command(two, 'close');
      expect(await one.closed).toBe(1000);
      expect(await two.closed).toBe(1000);
      await access(owner.target.accessToken).expect(201);
    }
  });

  it('rejects unbound, anonymous, browser/mixed transports, nonempty bodies and unknown query data', async () => {
    const owner = await fixture();
    await access(owner.approver.accessToken).expect(403);
    await api().post('/analysis/access').set(native).send({}).expect(401);
    await access(owner.target.accessToken, {
      lectureTitle: 'synthetic-private-marker',
    }).expect(400);
    await access(owner.target.accessToken, []).expect(400);
    await access(owner.target.accessToken)
      .set('Origin', 'https://localhost:3000')
      .expect(403);
    await access(owner.target.accessToken)
      .set('Cookie', 'untrusted=value')
      .expect(403);
    await api()
      .post('/analysis/access?secret=synthetic-private-marker')
      .set(native)
      .set('Authorization', `Bearer ${owner.target.accessToken}`)
      .send({})
      .expect(400);
    const browser = {
      'X-SmartBord-Client': 'browser',
      Origin: 'https://localhost:3000',
    };
    const csrf = await api().get('/auth/csrf').set(browser).expect(200);
    await api()
      .post('/analysis/access')
      .set(browser)
      .set('Cookie', csrf.headers['set-cookie'][0].split(';')[0])
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({})
      .expect(403);
  });

  it('stays disabled unless explicitly enabled and rejects disabled upgrades', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    config.enabled = false;
    await access(owner.target.accessToken).expect(503);
    await expect(open(issued.analyzeTicket)).rejects.toThrow('HTTP 503');
  });

  it('fails closed when required enrollment or authentication indexes are absent', async () => {
    const owner = await fixture();
    assertExactTestDatabase(connection, name);
    for (const [collection, index] of [
      ['pairingRequests', 'pairing_code_unique'],
      ['users', 'unique_normalized_username'],
    ]) {
      await connection.db!.collection(collection).dropIndex(index);
      try {
        await access(owner.target.accessToken).expect(503);
      } finally {
        await app.get(AuthSchemaService).prepare();
        await app.get(DeviceSchemaService).prepare();
      }
    }
  });

  it('binds tickets to endpoints and rejects access tokens, replay, mixed headers and query credentials', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    await expect(open(owner.target.accessToken)).rejects.toThrow('HTTP 401');
    await expect(open(issued.analyzeTicket, 'control')).rejects.toThrow(
      'HTTP 401',
    );
    await expect(
      open(issued.analyzeTicket, 'analyze', {
        Origin: 'https://localhost:3000',
      }),
    ).rejects.toThrow('HTTP 403');
    await expect(
      open(issued.analyzeTicket, 'analyze', { Cookie: 'untrusted=value' }),
    ).rejects.toThrow('HTTP 403');
    await expect(
      open(issued.analyzeTicket, 'analyze', {
        Authorization: [
          `Bearer ${issued.analyzeTicket}`,
          `Bearer ${issued.analyzeTicket}`,
        ],
      }),
    ).rejects.toThrow('HTTP 400');
    await expect(
      open(issued.analyzeTicket, 'analyze', {
        'Sec-WebSocket-Protocol': 'unsupported',
      }),
    ).rejects.toThrow('HTTP 400');
    await expect(
      open(
        issued.analyzeTicket,
        'analyze',
        {},
        '?token=synthetic-private-marker',
      ),
    ).rejects.toThrow('HTTP 404');
    const results = await Promise.allSettled([
      open(issued.analyzeTicket),
      open(issued.analyzeTicket),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(open(issued.analyzeTicket)).rejects.toThrow('HTTP 401');
    await open(issued.controlTicket, 'control');
  });

  it('enforces per-device and per-account reservations even for pending grants', async () => {
    const owner = await fixture();
    await grant(owner.target.accessToken);
    const busy = await access(owner.target.accessToken).expect(409);
    expect(busy.body.code).toBe('ANALYSIS_BUSY');
    const more = async () => {
      const target = await connection.transaction((session) =>
        app.get(AuthSessionService).create(owner.user, 'native', session),
      );
      const pairing = await app
        .get(DeviceEnrollmentService)
        .createPairing(
          { label: 'Synthetic Phone', platform: DevicePlatform.IOS },
          target.accessToken,
          'native',
        );
      await app
        .get(DeviceEnrollmentService)
        .confirmPairing(pairing.code, owner.approver.accessToken, 'native');
      return target;
    };
    await grant((await more()).accessToken);
    expect(
      (await access((await more()).accessToken).expect(409)).body.code,
    ).toBe('ANALYSIS_BUSY');
  });

  it('charges shared hashed IP/account grant budgets without storing credentials', async () => {
    const owner = await fixture();
    for (const [scope, identity, maximum] of [
      ['analysis:grant:account', owner.user._id, 10],
      ['analysis:grant:ip', '127.0.0.1', 30],
    ] as const) {
      assertExactTestDatabase(connection, name);
      await connection.db!.collection('authAttempts').deleteMany({});
      const bucket = Math.floor(Date.now() / 60_000);
      for (const minute of [bucket, bucket + 1])
        await connection.db!.collection('authAttempts').insertOne({
          _id: digest(`${scope}:${identity}:${minute}`) as never,
          count: maximum,
          expiresAt: new Date(Date.now() + 180_000),
        });
      expect(
        (await access(owner.target.accessToken).expect(429)).body.code,
      ).toBe('RATE_LIMITED');
    }
  });

  it.each([
    ['malformed JSON', '{', 1008],
    [
      'unknown command',
      JSON.stringify({ protocolVersion: 1, streamId: 'wrong', type: 'upload' }),
      1008,
    ],
    ['binary media', Buffer.from('synthetic-private-marker'), 1003],
    ['oversized text', 'x'.repeat(8_193), 1009],
  ])('rejects %s with bounded closure', async (_label, payload, expected) => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const client = await open(issued.analyzeTicket);
    client.ws.send(payload as string | Buffer);
    expect(await client.closed).toBe(expected);
    expect(JSON.stringify(client.messages)).not.toContain(
      'synthetic-private-marker',
    );
  });

  it('rejects unknown fields, wrong protocol and command floods', async () => {
    for (const extra of [
      { lectureTitle: 'synthetic-private-marker' },
      { protocolVersion: 2 },
      null,
    ]) {
      const owner = await fixture();
      const client = await open(
        (await grant(owner.target.accessToken)).analyzeTicket,
      );
      if (extra) command(client, 'status', extra);
      else for (let i = 0; i < 6; i++) command(client, 'heartbeat');
      expect(await client.closed).toBe(extra ? 1008 : 1013);
    }
  });

  it('keeps established sockets and pending tickets valid through normal refresh rotation', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const client = await open(issued.analyzeTicket);
    const rotated = await api()
      .post('/auth/refresh')
      .set(native)
      .send({ refreshToken: owner.target.refreshToken })
      .expect(200);
    await access(owner.target.accessToken).expect(401);
    await open(issued.controlTicket, 'control');
    await delay(1_200);
    command(client);
    await waitStatus(client);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    expect(rotated.body.accessToken).not.toBe(owner.target.accessToken);
  });

  it('closes both sockets after logout and preserves an unrelated account stream', async () => {
    const owner = await fixture();
    const other = await fixture();
    const issued = await grant(owner.target.accessToken);
    const one = await open(issued.analyzeTicket);
    const two = await open(issued.controlTicket, 'control');
    const independent = await open(
      (await grant(other.target.accessToken)).analyzeTicket,
    );
    await api()
      .post('/auth/logout')
      .set(native)
      .send({ refreshToken: owner.target.refreshToken })
      .expect(200);
    expect(await one.closed).toBe(1008);
    expect(await two.closed).toBe(1008);
    command(independent);
    await waitStatus(independent);
  });

  it.each([
    'revokeDevice',
    'revokeDevices',
    'adminRevokeDevice',
    'adminRevokeDevices',
  ])('closes bound sockets after %s', async (operation) => {
    const owner = await fixture();
    const actor = operation.startsWith('admin')
      ? await fixture('ADMIN', false)
      : owner;
    const issued = await grant(owner.target.accessToken);
    const one = await open(issued.analyzeTicket);
    const two = await open(issued.controlTicket, 'control');
    const bulk = operation.endsWith('Devices');
    const query = `mutation($input: ${bulk ? 'RevokeDevicesInput' : 'RevokeDeviceInput'}!) { ${operation}(input: $input) { ${bulk ? 'total' : 'id'} } }`;
    const response = await api()
      .post('/graphql')
      .set(native)
      .set('Authorization', `Bearer ${actor.approver.accessToken}`)
      .send({
        query,
        variables: {
          input: bulk ? { ids: [owner.deviceId] } : { id: owner.deviceId },
        },
      })
      .expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(await one.closed).toBe(1008);
    expect(await two.closed).toBe(1008);
    await expect(open(issued.analyzeTicket)).rejects.toThrow('HTTP 401');
  });

  it.each([{ status: AccountState.BLOCKED }, { role: AccountRole.ADMIN }])(
    'closes after account access change %p; reactivation restores no old grant',
    async (change) => {
      const owner = await fixture();
      const admin = await fixture('ADMIN', false);
      const issued = await grant(owner.target.accessToken);
      const client = await open(issued.analyzeTicket);
      await app
        .get(AdminService)
        .updateAccess(
          { id: owner.user._id, ...change },
          admin.approver.accessToken,
          'native',
        );
      expect(await client.closed).toBe(1008);
      if ('status' in change)
        await app
          .get(AdminService)
          .updateAccess(
            { id: owner.user._id, status: AccountState.ACTIVE },
            admin.approver.accessToken,
            'native',
          );
      await expect(open(issued.controlTicket, 'control')).rejects.toThrow(
        'HTTP 401',
      );
    },
  );

  it('closes all target streams on password reset without affecting another account', async () => {
    const owner = await fixture();
    const other = await fixture();
    const one = await open(
      (await grant(owner.target.accessToken)).analyzeTicket,
    );
    const two = await open(
      (await grant(other.target.accessToken)).analyzeTicket,
    );
    const proof = await app
      .get(PasswordRecoveryService)
      .issue(owner.user.email);
    await api()
      .post('/auth/password/reset')
      .set(native)
      .send({
        recoveryToken: proof.recoveryToken,
        password: 'synthetic-new-analysis-password',
      })
      .expect(200);
    expect(await one.closed).toBe(1008);
    command(two);
    await waitStatus(two);
  });

  it('fails closed on a stalled/outage identity check and ignores its late success', async () => {
    const owner = await fixture();
    const client = await open(
      (await grant(owner.target.accessToken)).analyzeTicket,
    );
    let release: () => void = () => undefined;
    const spy = jest
      .spyOn(app.get(AnalysisIdentityService), 'validate')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    expect(await client.closed).toBe(1011);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await delay(100);
    expect(client.ws.readyState).toBe(WebSocket.CLOSED);
    spy.mockRejectedValue(new Error('synthetic-private-marker'));
    await access(owner.target.accessToken).expect(503);
  });

  it('does not persist grants, submitted media or private fields, and emits no content logs', async () => {
    const logs = [
      jest.spyOn(Logger.prototype, 'error'),
      jest.spyOn(Logger.prototype, 'warn'),
      jest.spyOn(Logger.prototype, 'log'),
    ];
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const client = await open(issued.analyzeTicket);
    client.ws.send(Buffer.from('synthetic-private-marker'));
    await client.closed;
    await access(owner.target.accessToken, {
      notes: 'synthetic-private-marker',
    }).expect(400);
    const collections = await connection
      .db!.listCollections({}, { nameOnly: true })
      .toArray();
    expect(collections.map((c) => c.name).sort()).toEqual([
      'auditEvents',
      'authAttempts',
      'authSessions',
      'devices',
      'pairingRequests',
      'platformSettings',
      'users',
    ]);
    for (const collection of collections) {
      const records = JSON.stringify(
        await connection.db!.collection(collection.name).find({}).toArray(),
      );
      for (const marker of [
        'synthetic-private-marker',
        issued.streamId,
        issued.analyzeTicket,
        issued.controlTicket,
        owner.target.accessToken,
        owner.target.refreshToken,
      ])
        expect(records).not.toContain(marker);
    }
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toMatch(
      /synthetic-private-marker|Bearer|sb_a\.|sb_r\./,
    );
  });

  it('closes streams and rejects new grants when the actual fixture database connection goes down', async () => {
    const owner = await fixture();
    const client = await open(
      (await grant(owner.target.accessToken)).analyzeTicket,
    );
    assertExactTestDatabase(connection, name);
    const settings = parseDatabaseEnvironment(process.env, 'test');
    const reopen = async () => {
      try {
        await connection.openUri(settings.uri, {
          dbName: name,
          autoCreate: false,
          autoIndex: false,
          bufferCommands: false,
          serverSelectionTimeoutMS: 5_000,
          connectTimeoutMS: 5_000,
          socketTimeoutMS: 5_000,
          maxPoolSize: 10,
          minPoolSize: 0,
          monitorCommands: false,
        });
      } catch {
        throw new Error(
          'Disposable connection could not reopen for guarded cleanup.',
        );
      }
      assertExactTestDatabase(connection, name);
    };
    try {
      await connection.close();
      expect(await client.closed).toBe(1011);
      await access(owner.target.accessToken).expect(503);
    } finally {
      await reopen();
    }
  });

  it('expires idle sockets and unused tickets after thirty real seconds and releases capacity', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const client = await open(issued.analyzeTicket);
    expect(await client.closed).toBe(1000);
    await expect(open(issued.controlTicket, 'control')).rejects.toThrow(
      'HTTP 401',
    );
    await grant(owner.target.accessToken);
  });

  it('enforces original access expiry despite refresh and regular commands', async () => {
    const owner = await fixture();
    assertExactTestDatabase(connection, name);
    const expiry = new Date(Date.now() + 4_000);
    await connection
      .db!.collection('authSessions')
      .updateOne(
        { _id: owner.target.accessToken.split('.')[1] as never },
        { $set: { accessExpiresAt: expiry } },
      );
    const issued = await grant(owner.target.accessToken);
    expect(issued.expiresAt).toBe(expiry.toISOString());
    const client = await open(issued.analyzeTicket);
    await api()
      .post('/auth/refresh')
      .set(native)
      .send({ refreshToken: owner.target.refreshToken })
      .expect(200);
    const timer = setInterval(() => {
      if (client.ws.readyState === WebSocket.OPEN) command(client);
    }, 500);
    try {
      expect(await client.closed).toBe(1000);
    } finally {
      clearInterval(timer);
    }
    expect(Date.now()).toBeGreaterThanOrEqual(expiry.getTime());
  });

  it('closes existing sockets and rejects all grants during application shutdown', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const client = await open(issued.analyzeTicket);
    await app.close();
    expect(await client.closed).toBe(1001);
  });
});
