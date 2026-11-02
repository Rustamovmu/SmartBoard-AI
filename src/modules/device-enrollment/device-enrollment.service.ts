import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { AdminPolicyService } from '../admin/admin-policy.service';
import { AuditService } from '../audit/audit.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  AUTH_SESSION_MODEL,
  AuthSession,
} from '../auth/schemas/auth-session.schema';
import { digest } from '../auth/token.service';
import { DeviceSchemaService } from './device-schema.service';
import type { CreateDevicePairingInput, DevicesInput } from './dto/device.dto';
import { DEVICE_MODEL, Device } from './schemas/device.schema';
import {
  PAIRING_MODEL,
  PairingRequest,
} from './schemas/pairing-request.schema';

export const DEVICE_POLICY = {
  pairingLifetimeMs: 5 * 60_000,
  maximumActiveDevices: 20,
} as const;
type Actor = Awaited<ReturnType<AuthSessionService['authenticate']>>;

@Injectable()
export class DeviceEnrollmentService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DEVICE_MODEL) private readonly devices: Model<Device>,
    @InjectModel(PAIRING_MODEL)
    private readonly pairings: Model<PairingRequest>,
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    private readonly authentication: AuthSessionService,
    private readonly schema: DeviceSchemaService,
    private readonly policy: AdminPolicyService,
    private readonly audit: AuditService,
    private readonly limits: AuthRateLimitService,
  ) {}

  private publicDevice(device: Device) {
    return {
      id: device._id,
      userId: device.userId,
      label: device.label,
      platform: device.platform,
      status: device.status,
      createdAt: device.createdAt.toISOString(),
      revokedAt: device.revokedAt?.toISOString() ?? null,
    };
  }

  private async mutate<T>(
    credential: string,
    transport: AuthTransport,
    scope: string,
    maximum: number,
    work: (actor: Actor, session: ClientSession) => Promise<T>,
    cost = 1,
  ) {
    await this.schema.assertPrepared();
    const account = await this.authentication.authenticate(
      credential,
      transport,
    );
    // Outside the transaction: failed approvals still consume their rate budget.
    await this.limits.consume(scope, account.user._id, maximum, cost);
    return this.connection.transaction(async (session) => {
      // Shares ordering with account blocking/role changes and admin bootstrap.
      await this.policy.acquire(session);
      const actor = await this.authentication.authenticate(
        credential,
        transport,
        session,
      );
      return work(actor, session);
    });
  }

  createPairing(
    input: CreateDevicePairingInput,
    credential: string,
    transport: AuthTransport,
  ) {
    if (transport !== 'native') throw new ForbiddenException();
    return this.mutate(
      credential,
      transport,
      'enrollment:create',
      5,
      async (actor, session) => {
        if (actor.deviceId) throw new ConflictException();
        const code = randomBytes(32).toString('base64url');
        const expiresAt = new Date(
          Date.now() + DEVICE_POLICY.pairingLifetimeMs,
        );
        await this.pairings.replaceOne(
          { _id: actor.sessionId },
          {
            _id: actor.sessionId,
            userId: actor.user._id,
            codeHash: digest(code),
            label: input.label,
            platform: input.platform,
            expiresAt,
            consumedAt: null,
          },
          { upsert: true, session, runValidators: true },
        );
        return { code, expiresAt: expiresAt.toISOString() };
      },
    );
  }

  confirmPairing(code: string, credential: string, transport: AuthTransport) {
    return this.mutate(
      credential,
      transport,
      'enrollment:confirm',
      10,
      async (actor, session) => {
        const now = new Date();
        const pending = await this.pairings
          .findOne({
            codeHash: digest(code),
            userId: actor.user._id,
            consumedAt: null,
            expiresAt: { $gt: now },
          })
          .session(session)
          .lean()
          .exec();
        // Same safe result for unknown, foreign, expired or used codes.
        if (!pending) throw new NotFoundException();
        if (pending._id === actor.sessionId) throw new ForbiddenException();
        const target = await this.sessions
          .findOne({
            _id: pending._id,
            userId: actor.user._id,
            transport: 'native',
            revokedAt: null,
            expiresAt: { $gt: now },
            accountVersion: actor.user.authVersion,
            deviceId: null,
          })
          .session(session)
          .lean()
          .exec();
        if (!target) throw new ConflictException();
        const count = await this.devices
          .countDocuments({ userId: actor.user._id, status: 'ACTIVE' })
          .session(session)
          .exec();
        if (count >= DEVICE_POLICY.maximumActiveDevices)
          throw new ConflictException();
        const [device] = await this.devices.create(
          [
            {
              _id: randomUUID(),
              userId: actor.user._id,
              label: pending.label,
              platform: pending.platform,
              status: 'ACTIVE',
              createdAt: now,
              revokedAt: null,
            },
          ],
          { session },
        );
        await this.sessions.updateOne(
          { _id: target._id },
          { $set: { deviceId: device._id } },
          { session },
        );
        await this.pairings.updateOne(
          { _id: pending._id },
          { $set: { consumedAt: now } },
          { session },
        );
        await this.audit.deviceChanged(
          'DEVICE_ENROLLED',
          actor.user._id,
          actor.user.role,
          actor.user._id,
          device._id,
          session,
        );
        return this.publicDevice(device);
      },
    );
  }

  async list(userId: string, input: DevicesInput) {
    await this.schema.assertPrepared();
    const filter = {
      userId,
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const [items, total] = await Promise.all([
      this.devices
        .find(filter)
        .sort({ createdAt: -1, _id: 1 })
        .skip((input.page - 1) * input.pageSize)
        .limit(input.pageSize)
        .lean()
        .exec(),
      this.devices.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((device) => this.publicDevice(device)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async current(deviceId: string | null | undefined, userId: string) {
    await this.schema.assertPrepared();
    if (!deviceId) return null;
    const device = await this.devices
      .findOne({ _id: deviceId, userId, status: 'ACTIVE' })
      .lean()
      .exec();
    return device ? this.publicDevice(device) : null;
  }

  async revoke(
    id: string,
    credential: string,
    transport: AuthTransport,
    administrator = false,
  ) {
    const result = await this.revokeMany(
      [id],
      credential,
      transport,
      administrator,
    );
    return result.items[0];
  }

  revokeMany(
    ids: string[],
    credential: string,
    transport: AuthTransport,
    administrator = false,
  ) {
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException();
    return this.mutate(
      credential,
      transport,
      'enrollment:revoke',
      20,
      async (actor, session) => {
        if (administrator && actor.user.role !== 'ADMIN')
          throw new ForbiddenException();
        const devices = await this.devices
          .find({
            _id: { $in: ids },
            ...(administrator ? {} : { userId: actor.user._id }),
          })
          .session(session)
          .lean()
          .exec();
        // Validate the entire selection before writes. Missing and foreign IDs
        // share one rejection, without revealing per-ID existence/ownership.
        if (devices.length !== ids.length) throw new NotFoundException();
        const active = devices.filter((device) => device.status === 'ACTIVE');
        const activeIds = active.map((device) => device._id);
        const revokedAt = new Date();
        if (activeIds.length) {
          await this.devices.updateMany(
            { _id: { $in: activeIds } },
            { $set: { status: 'REVOKED', revokedAt } },
            { session },
          );
          await this.sessions.updateMany(
            { deviceId: { $in: activeIds }, revokedAt: null },
            { $set: { revokedAt } },
            { session },
          );
          // Sequential operations are required on one MongoDB transaction session.
          for (const device of active)
            await this.audit.deviceChanged(
              'DEVICE_REVOKED',
              actor.user._id,
              actor.user.role,
              device.userId,
              device._id,
              session,
            );
        }
        const byId = new Map(devices.map((device) => [device._id, device]));
        return {
          items: ids.map((id) => {
            const device = byId.get(id)!;
            return {
              ...this.publicDevice(device),
              status: 'REVOKED',
              revokedAt:
                device.revokedAt?.toISOString() ?? revokedAt.toISOString(),
            };
          }),
          page: 1,
          pageSize: ids.length,
          total: ids.length,
        };
      },
      ids.length,
    );
  }
}
