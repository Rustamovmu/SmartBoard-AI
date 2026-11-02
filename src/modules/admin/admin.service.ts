import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { AuditService } from '../audit/audit.service';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  AUTH_SESSION_MODEL,
  AuthSession,
} from '../auth/schemas/auth-session.schema';
import { MembersService } from '../members/members.service';
import { MEMBER_MODEL, Member } from '../members/schemas/member.schema';
import { AdminPolicyService } from './admin-policy.service';
import type {
  AccountsInput,
  UpdateAccountAccessInput,
} from './dto/account.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MEMBER_MODEL) private readonly users: Model<Member>,
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    private readonly members: MembersService,
    private readonly authentication: AuthSessionService,
    private readonly policy: AdminPolicyService,
    private readonly audit: AuditService,
  ) {}

  async accounts(input: AccountsInput) {
    const filter = {
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const [items, total] = await Promise.all([
      this.users
        .find(filter)
        .sort({ createdAt: -1, _id: 1 })
        .skip((input.page - 1) * input.pageSize)
        .limit(input.pageSize)
        .lean()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((user) => this.members.publicMember(user)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async updateAccess(
    input: UpdateAccountAccessInput,
    credential: string,
    transport: AuthTransport,
  ) {
    if (input.role === undefined && input.status === undefined)
      throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      // Every admin mutation and CLI bootstrap writes this first. Retried transactions
      // then see the new actor permissions and active-admin count, avoiding write skew.
      await this.policy.acquire(session);
      const actor = await this.authentication.authenticate(
        credential,
        transport,
        session,
      );
      if (actor.user.role !== 'ADMIN') throw new ForbiddenException();
      const target = await this.members.findCurrent(input.id, session);
      if (!target) throw new NotFoundException();
      const role = input.role ?? target.role;
      const status = input.status ?? target.status;
      if (target.role === role && target.status === status)
        return this.members.publicMember(target);
      if (
        target.role === 'ADMIN' &&
        target.status === 'ACTIVE' &&
        (role !== 'ADMIN' || status !== 'ACTIVE')
      ) {
        const activeAdmins = await this.users
          .countDocuments({ role: 'ADMIN', status: 'ACTIVE' })
          .session(session)
          .exec();
        if (activeAdmins <= 1) throw new ConflictException();
      }
      await this.users.updateOne(
        { _id: target._id },
        { $set: { role, status }, $inc: { authVersion: 1 } },
        { session, runValidators: true },
      );
      await this.sessions.updateMany(
        { userId: target._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      await this.audit.accountAccessChanged(
        actor.user._id,
        target._id,
        { role: target.role, status: target.status },
        { role, status },
        session,
      );
      return { ...this.members.publicMember(target), role, status };
    });
  }
}
