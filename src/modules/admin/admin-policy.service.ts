import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import {
  ADMIN_POLICY_ID,
  ADMIN_POLICY_MODEL,
  AdminPolicy,
} from './schemas/admin-policy.schema';

@Injectable()
export class AdminPolicyService {
  constructor(
    @InjectModel(ADMIN_POLICY_MODEL)
    private readonly policy: Model<AdminPolicy>,
  ) {}

  /** Explicit setup only; never overwrite an existing policy or reset its revision. */
  async prepare() {
    await this.policy.createCollection();
    await this.policy.updateOne(
      { _id: ADMIN_POLICY_ID },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
  }

  async acquire(session: ClientSession) {
    const result = await this.policy.updateOne(
      { _id: ADMIN_POLICY_ID },
      { $inc: { revision: 1 } },
      { session },
    );
    if (result.matchedCount !== 1) throw new ServiceUnavailableException();
  }
}
