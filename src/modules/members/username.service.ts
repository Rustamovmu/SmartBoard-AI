import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { AdminPolicyService } from '../admin/admin-policy.service';
import { AuditService } from '../audit/audit.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { AuthSchemaService } from '../auth/auth-schema.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { MembersService } from './members.service';
import { MEMBER_MODEL, Member } from './schemas/member.schema';
import type { SetMyUsernameInput } from './dto/username.dto';
@Injectable()
export class UsernameService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MEMBER_MODEL) private readonly users: Model<Member>,
    private readonly members: MembersService,
    private readonly schema: AuthSchemaService,
    private readonly authentication: AuthSessionService,
    private readonly policy: AdminPolicyService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}
  async set(
    input: SetMyUsernameInput,
    credential: string,
    transport: AuthTransport,
    expectedUserId: string,
  ) {
    await this.schema.assertPrepared();
    await this.limits.consume('username:set:account', expectedUserId, 5);
    try {
      return await this.connection.transaction(async (session) => {
        await this.policy.acquire(session);
        const actor = await this.authentication.authenticate(
          credential,
          transport,
          session,
        );
        if (actor.user._id !== expectedUserId)
          throw new UnauthorizedException();
        if (actor.user.username === input.username)
          return this.members.publicMember(actor.user);
        if (actor.user.username !== undefined) throw new ConflictException();
        const updated = await this.users
          .findOneAndUpdate(
            { _id: actor.user._id, username: { $exists: false } },
            { $set: { username: input.username } },
            { returnDocument: 'after', session, runValidators: true },
          )
          .lean()
          .exec();
        if (!updated) throw new ConflictException();
        await this.audit.usernameSet(actor.user, session);
        return this.members.publicMember(updated);
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 11000
      )
        throw new ConflictException();
      throw error;
    }
  }
}
