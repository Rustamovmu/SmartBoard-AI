import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  AUTH_SESSION_MODEL,
  AuthSession,
} from '../auth/schemas/auth-session.schema';
import { MEMBER_MODEL, Member } from '../members/schemas/member.schema';
import {
  DEVICE_MODEL,
  Device,
} from '../device-enrollment/schemas/device.schema';

/** Internal, server-owned identity. Never accepted from a client or persisted. */
export interface AnalysisBinding {
  sessionId: string;
  userId: string;
  deviceId: string;
  accountVersion: number;
  expiresAt: number;
}

@Injectable()
export class AnalysisIdentityService {
  constructor(
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    @InjectModel(MEMBER_MODEL) private readonly users: Model<Member>,
    @InjectModel(DEVICE_MODEL) private readonly devices: Model<Device>,
  ) {}

  /** Read only. Token rotation is independent of this already-authorized binding. */
  async validate(binding: AnalysisBinding): Promise<void> {
    if (binding.expiresAt <= Date.now()) throw new UnauthorizedException();
    const [session, user, device] = await Promise.all([
      this.sessions
        .findOne({
          _id: binding.sessionId,
          userId: binding.userId,
          deviceId: binding.deviceId,
          transport: 'native',
          revokedAt: null,
          accountVersion: binding.accountVersion,
          expiresAt: { $gt: new Date() },
        })
        .select('_id')
        .maxTimeMS(1_500)
        .lean()
        .exec(),
      this.users
        .findOne({
          _id: binding.userId,
          status: 'ACTIVE',
          authVersion: binding.accountVersion,
        })
        .select('_id')
        .maxTimeMS(1_500)
        .lean()
        .exec(),
      this.devices
        .findOne({
          _id: binding.deviceId,
          userId: binding.userId,
          status: 'ACTIVE',
        })
        .select('_id')
        .maxTimeMS(1_500)
        .lean()
        .exec(),
    ]);
    if (!session || !user || !device || binding.expiresAt <= Date.now())
      throw new UnauthorizedException();
  }
}
