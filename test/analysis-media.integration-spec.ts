import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AnalysisMediaService } from '../src/modules/analysis-access/analysis-media.service';
import { AnalysisRegistryService } from '../src/modules/analysis-access/analysis-registry.service';
import { MEDIA_LIMITS } from '../src/contracts/analysis-media-v2';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
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
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { PasswordRecoveryService } from '../src/modules/auth/password-recovery.service';
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
  protocolVersion: number;
  streamId: string;
  code?: string;
  capabilities?: object;
}
interface Client {
  ws: WebSocket;
  messages: Wire[];
  results: Buffer[];
  closed: Promise<number>;
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('authenticated measurement bridge with real workers and disposable MongoDB', () => {
  let app: NestExpressApplication;
  let connection: Connection;
  let name: string;
  let owned = false;
  let base: string;
  let passwordHash: string;
  const config = {
    enabled: true,
    mediaEnabled: true,
    projectRoot: process.cwd(),
    pythonExecutable: resolve('vision/.venv/bin/python'),
  };
  let jpeg: Buffer;
  let media: AnalysisMediaService;
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
    (
      await access(token, { protocolVersion: 2 })
        .expect(201)
        .expect('Cache-Control', 'no-store')
    ).body;
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
        results: [],
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
      ws.on('message', (raw, binary) => {
        if (binary) {
          client.results.push(Buffer.from(raw as Buffer));
          return;
        }
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

  const until = async (condition: () => boolean, maximum = 8000) => {
    const deadline = Date.now() + maximum;
    while (!condition() && Date.now() < deadline) await delay(10);
    expect(condition()).toBe(true);
  };
  const packet = (client: Client, id = 1, extra: object = {}, image = jpeg) => {
    const header = Buffer.from(
      JSON.stringify({
        protocolVersion: 2,
        type: 'frame',
        streamId: client.messages[0].streamId,
        frameId: id,
        sourceTimeMs: id * 100,
        width: 320,
        height: 240,
        corners: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        ...extra,
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(header.length);
    return Buffer.concat([prefix, header, image]);
  };
  const measure = async (client: Client, id = 1) => {
    client.ws.send(packet(client, id));
    await until(() => client.results.length >= id);
    const bytes = client.results[id - 1];
    const length = bytes.readUInt32BE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + length).toString());
    expect(header).toMatchObject({
      protocolVersion: 2,
      type: 'result',
      frameId: id,
      sourceTimeMs: id * 100,
      measurements: {
        source_width: 320,
        source_height: 240,
        rectified_width: 320,
        rectified_height: 240,
        tracking: 'unverified',
        automatic_capture_eligible: false,
        people: { status: 'available' },
      },
    });
    expect(bytes.length).toBe(
      4 + length + header.rectifiedBytes + header.enhancedBytes,
    );
    const rectified = bytes.subarray(
      4 + length,
      4 + length + header.rectifiedBytes,
    );
    expect(rectified.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
    const decoded = execFileSync(
      config.pythonExecutable,
      [
        '-B',
        '-c',
        'import sys,cv2,numpy as np,json; a=cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(2000001),np.uint8),cv2.IMREAD_COLOR);print(json.dumps(list(a.shape)))',
      ],
      {
        input: rectified,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        maxBuffer: 1000,
        timeout: 5000,
      },
    );
    expect(JSON.parse(decoded.toString())).toEqual([240, 320, 3]);
  };
  beforeAll(async () => {
    jpeg = execFileSync(
      config.pythonExecutable,
      [
        '-B',
        '-c',
        'import cv2,numpy as np,sys; a=np.full((240,320,3),235,np.uint8);cv2.putText(a,"SYNTHETIC BRIDGE",(10,100),cv2.FONT_HERSHEY_SIMPLEX,.6,(20,20,20),2);sys.stdout.buffer.write(cv2.imencode(".jpg",a)[1].tobytes())',
      ],
      {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        maxBuffer: 2_000_000,
        timeout: 10_000,
      },
    );
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
    media = app.get(AnalysisMediaService);
    await media.waitUntilReady();
  });
  beforeEach(async () => {
    config.enabled = true;
    config.mediaEnabled = true;
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
    for (const client of clients)
      for (const result of client.results) result.fill(0);
    clients.length = 0;
    jest.restoreAllMocks();
    if (media) await until(() => media.busyCount === 0);
  });
  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      jpeg?.fill(0);
      try {
        if (owned) await dropOwnedTestDatabase(connection, name);
      } finally {
        if (connection?.readyState) await connection.close();
      }
    }
  });

  it('keeps V1 native grants and limits unchanged even when media workers are enabled', async () => {
    const owner = await fixture();
    const issued = (await access(owner.target.accessToken).expect(201)).body;
    expect(issued).toMatchObject({
      protocolVersion: 1,
      capabilities: { vision: false, acceptsFrames: false },
    });
    const client = await open(issued.analyzeTicket);
    expect(client.messages[0].protocolVersion).toBe(1);
    client.ws.send(Buffer.from([1]));
    expect(await client.closed).toBe(1003);
  });
  it('requires the separate media flag and prepared/authenticated device ownership', async () => {
    const owner = await fixture();
    config.mediaEnabled = false;
    expect(
      (
        await access(owner.target.accessToken, { protocolVersion: 2 }).expect(
          503,
        )
      ).body.code,
    ).toBe('VISION_UNAVAILABLE');
    config.mediaEnabled = true;
    await access(owner.approver.accessToken, { protocolVersion: 2 }).expect(
      403,
    );
    await api()
      .post('/analysis/access')
      .set(native)
      .send({ protocolVersion: 2 })
      .expect(401);
    await access(owner.target.accessToken, {
      protocolVersion: 2,
      notes: 'synthetic-private-marker',
    }).expect(400);
    await api()
      .post('/analysis/access')
      .set(native)
      .set('Authorization', `Bearer ${owner.target.accessToken}`)
      .set('Content-Type', 'application/json')
      .send('{"protocolVersion":2,"protocolVersion":2}')
      .expect(400);
  });
  it('returns actual binary measurements/images and supports sequential fresh frames', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    expect(issued).toMatchObject({
      protocolVersion: 2,
      capabilities: {
        vision: true,
        acceptsFrames: true,
        automaticCapture: false,
      },
    });
    const client = await open(issued.analyzeTicket);
    expect(client.messages[0]).toMatchObject({
      protocolVersion: 2,
      capabilities: {
        vision: true,
        acceptsFrames: true,
        automaticCapture: false,
      },
    });
    await measure(client);
    await measure(client, 2);
    expect(media.processCount).toBeLessThanOrEqual(2);
  });
  it.each([
    ['unknown fields', { notes: 'synthetic-private-marker' }],
    ['wrong version', { protocolVersion: 1 }],
    ['foreign stream', { streamId: randomUUID() }],
    ['invalid dimensions', { width: 8192, height: 8192 }],
    ['nonfinite time', { sourceTimeMs: null }],
    [
      'invalid corners',
      {
        corners: [
          [0, 0],
          [2, 0],
          [1, 1],
          [0, 1],
        ],
      },
    ],
  ])(
    'rejects %s without leaking input or starting work',
    async (_name, extra) => {
      const owner = await fixture();
      const client = await open(
        (await grant(owner.target.accessToken)).analyzeTicket,
      );
      client.ws.send(packet(client, 1, extra));
      expect(await client.closed).toBe(1008);
      expect(client.results).toHaveLength(0);
      expect(JSON.stringify(client.messages)).not.toContain(
        'synthetic-private-marker',
      );
    },
  );
  it('rejects duplicate frame IDs and never processes a queued second frame', async () => {
    const owner = await fixture();
    const client = await open(
      (await grant(owner.target.accessToken)).analyzeTicket,
    );
    await measure(client);
    client.ws.send(packet(client));
    expect(await client.closed).toBe(1008);
    expect(client.results).toHaveLength(1);
    const other = await fixture();
    const second = await open(
      (await grant(other.target.accessToken)).analyzeTicket,
    );
    second.ws.send(packet(second));
    second.ws.send(packet(second, 2));
    expect(await second.closed).toBe(1013);
    expect(second.results).toHaveLength(0);
  });
  it('preserves 8KiB control/text limits and enforces the JPEG envelope bound', async () => {
    const owner = await fixture();
    const issued = await grant(owner.target.accessToken);
    const control = await open(issued.controlTicket, 'control');
    expect(control.messages[0]).toMatchObject({
      capabilities: { acceptsFrames: false },
    });
    control.ws.send(Buffer.from([1]));
    expect(await control.closed).toBe(1003);
    const analysis = await open(issued.analyzeTicket);
    analysis.ws.send('x'.repeat(8193));
    expect(await analysis.closed).toBe(1009);
    const other = await fixture();
    const big = await open(
      (await grant(other.target.accessToken)).analyzeTicket,
    );
    big.ws.send(Buffer.alloc(MEDIA_LIMITS.requestBytes + 1));
    expect(await big.closed).toBe(1009);
  });
  it('cancels immediately on analysis disconnect before authorization completes', async () => {
    const owner = await fixture();
    const client = await open(
      (await grant(owner.target.accessToken)).analyzeTicket,
    );
    const registry = app.get(AnalysisRegistryService);
    const original = registry.validate.bind(registry);
    let release = () => undefined;
    let reached = false;
    const spy = jest
      .spyOn(registry, 'validate')
      .mockImplementation((binding, signal) => {
        if (signal && !reached) {
          reached = true;
          return new Promise<void>((done, reject) => {
            release = () => {
              void original(binding, signal).then(done, reject);
            };
          });
        }
        return original(binding, signal);
      });
    try {
      client.ws.send(packet(client));
      await until(() => reached);
      client.ws.terminate();
      await client.closed;
      release();
      await delay(100);
      expect(client.results).toHaveLength(0);
      expect(media.processCount).toBeLessThanOrEqual(2);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it.each(['logout', 'revoke', 'bulkRevoke', 'reset', 'block', 'role'])(
    'drops a real completed result on %s before final authorization',
    async (action) => {
      const owner = await fixture();
      const admin = ['block', 'role'].includes(action)
        ? await fixture('ADMIN', false)
        : undefined;
      const client = await open(
        (await grant(owner.target.accessToken)).analyzeTicket,
      );
      const registry = app.get(AnalysisRegistryService);
      const original = registry.validate.bind(registry);
      let release = () => undefined;
      let checks = 0;
      let reached = false;
      const spy = jest
        .spyOn(registry, 'validate')
        .mockImplementation((binding, signal) => {
          if (signal && ++checks === 2) {
            reached = true;
            return new Promise<void>((done, reject) => {
              release = () => {
                void original(binding, signal).then(done, reject);
              };
            });
          }
          return original(binding, signal);
        });
      try {
        client.ws.send(packet(client));
        await until(() => reached);
        if (action === 'logout')
          await api()
            .post('/auth/logout')
            .set(native)
            .send({ refreshToken: owner.target.refreshToken })
            .expect(200);
        else if (action === 'reset') {
          const proof = await app
            .get(PasswordRecoveryService)
            .issue(owner.user.email);
          await api()
            .post('/auth/password/reset')
            .set(native)
            .send({
              recoveryToken: proof.recoveryToken,
              password: 'synthetic-reset-password',
            })
            .expect(200);
        } else if (action === 'block' || action === 'role') {
          await app.get(AdminService).updateAccess(
            {
              id: owner.user._id,
              ...(action === 'block'
                ? { status: AccountState.BLOCKED }
                : { role: AccountRole.ADMIN }),
            },
            admin!.approver.accessToken,
            'native',
          );
        } else {
          const bulk = action === 'bulkRevoke';
          const response = await api()
            .post('/graphql')
            .set(native)
            .set('Authorization', `Bearer ${owner.approver.accessToken}`)
            .send({
              query: `mutation($input:${bulk ? 'RevokeDevicesInput' : 'RevokeDeviceInput'}!){${bulk ? 'revokeDevices' : 'revokeDevice'}(input:$input){${bulk ? 'total' : 'id'}}}`,
              variables: {
                input: bulk
                  ? { ids: [owner.deviceId] }
                  : { id: owner.deviceId },
              },
            })
            .expect(200);
          expect(response.body.errors).toBeUndefined();
        }
        release();
        await client.closed;
        await delay(100);
        expect(client.results).toHaveLength(0);
        expect(media.processCount).toBeLessThanOrEqual(2);
      } finally {
        release();
        spy.mockRestore();
      }
    },
  );
  it('never starts more than two processes under competing owners and cleans up all workers', async () => {
    const owners = await Promise.all([fixture(), fixture(), fixture()]);
    const active = await Promise.all(
      owners.map(async (owner) =>
        open((await grant(owner.target.accessToken)).analyzeTicket),
      ),
    );
    for (const client of active) client.ws.send(packet(client));
    await until(() =>
      active.every(
        (client) =>
          client.results.length === 1 ||
          client.ws.readyState === WebSocket.CLOSED,
      ),
    );
    expect(active.some((client) => client.results.length === 1)).toBe(true);
    expect(media.processCount).toBeLessThanOrEqual(2);
    for (const client of active) client.ws.terminate();
    await Promise.all(active.map((client) => client.closed));
    await app.close();
    expect(media.processCount).toBe(0);
  });
});
