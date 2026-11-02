import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Model } from 'mongoose';
import { AUDIT_MODEL, AuditEvent } from './schemas/audit-event.schema';
import type { AccountStatus, MemberRole } from '../../contracts/auth-v1';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AUDIT_MODEL) private readonly events: Model<AuditEvent>,
  ) {}
  async prepare() {
    await this.events.createCollection();
    await this.events.createIndexes();
  }
  async accountAccessChanged(
    actor: string,
    subject: string,
    before: { role: MemberRole; status: AccountStatus },
    after: { role: MemberRole; status: AccountStatus },
    session: ClientSession,
  ) {
    await this.events.create(
      [
        {
          _id: randomUUID(),
          action: 'ACCOUNT_ACCESS_CHANGED',
          actorType: 'ADMIN',
          actorUserId: actor,
          subjectUserId: subject,
          previousRole: before.role,
          nextRole: after.role,
          previousStatus: before.status,
          nextStatus: after.status,
          createdAt: new Date(),
        },
      ],
      { session },
    );
  }
  async administratorBootstrapped(id: string, session: ClientSession) {
    await this.events.create(
      [
        {
          _id: randomUUID(),
          action: 'ADMIN_BOOTSTRAPPED',
          actorType: 'LOCAL_COMMAND',
          subjectUserId: id,
          createdAt: new Date(),
        },
      ],
      { session },
    );
  }

  async deviceChanged(
    action: 'DEVICE_ENROLLED' | 'DEVICE_REVOKED',
    actor: string,
    actorType: MemberRole,
    subject: string,
    device: string,
    session: ClientSession,
  ) {
    await this.events.create(
      [
        {
          _id: randomUUID(),
          action,
          actorType,
          actorUserId: actor,
          subjectUserId: subject,
          subjectDeviceId: device,
          createdAt: new Date(),
        },
      ],
      { session },
    );
  }
}
