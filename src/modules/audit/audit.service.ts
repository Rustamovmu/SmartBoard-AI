import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Model } from 'mongoose';
import { AUDIT_MODEL, AuditEvent } from './schemas/audit-event.schema';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AUDIT_MODEL) private readonly events: Model<AuditEvent>,
  ) {}
  async prepare() {
    await this.events.createCollection();
    await this.events.createIndexes();
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
}
