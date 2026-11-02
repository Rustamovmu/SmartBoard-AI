import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import { AdminPolicyService } from '../admin/admin-policy.service';
import { AuditService } from '../audit/audit.service';
import { MEMBER_MODEL, Member } from '../members/schemas/member.schema';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSchemaService } from './auth-schema.service';
import { PasswordService } from './password.service';
import { AUTH_SESSION_MODEL, AuthSession } from './schemas/auth-session.schema';
import { digest } from './token.service';

export const PASSWORD_RECOVERY_LIFETIME_MS = 15 * 60_000;

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MEMBER_MODEL) private readonly users: Model<Member>,
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    private readonly schema: AuthSchemaService,
    private readonly policy: AdminPolicyService,
    private readonly passwords: PasswordService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}

  /** Privileged local operator only. Intentionally has no HTTP/GraphQL issuer. */
  async issue(email: string) {
    await this.schema.assertPrepared();
    await this.schema.assertRecoveryPrepared();
    return this.connection.transaction(async (session) => {
      await this.policy.acquire(session);
      const user = await this.users
        .findOne({ email, status: 'ACTIVE' })
        .select('+authVersion')
        .session(session)
        .lean()
        .exec();
      if (!user) throw new NotFoundException();
      const recoveryToken = `sb_p.${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(Date.now() + PASSWORD_RECOVERY_LIFETIME_MS);
      await this.users.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordRecoveryHash: digest(recoveryToken),
            passwordRecoveryExpiresAt: expiresAt,
            passwordRecoveryVersion: user.authVersion,
          },
        },
        { session, runValidators: true },
      );
      await this.audit.passwordRecovery(
        'PASSWORD_RECOVERY_ISSUED',
        user._id,
        session,
      );
      return { recoveryToken, expiresAt: expiresAt.toISOString() };
    });
  }

  private async findUsable(hash: string, session?: ClientSession) {
    const user = await this.users
      .findOne({
        passwordRecoveryHash: hash,
        passwordRecoveryExpiresAt: { $gt: new Date() },
        status: 'ACTIVE',
      })
      .select('+authVersion +passwordRecoveryVersion')
      .session(session ?? null)
      .lean()
      .exec();
    if (!user || user.passwordRecoveryVersion !== user.authVersion)
      throw new UnauthorizedException();
    return user;
  }

  async reset(recoveryToken: string, password: string) {
    await this.schema.assertRecoveryPrepared();
    const hash = digest(recoveryToken);
    await this.limits.consume('recovery:proof', hash, 5);
    // Reject unusable proofs before expensive password work; recheck inside the
    // transaction after hashing and any retried concurrent account change.
    await this.findUsable(hash);
    const passwordHash = await this.passwords.hash(password);
    await this.connection.transaction(async (session) => {
      await this.policy.acquire(session);
      const user = await this.findUsable(hash, session);
      await this.users.updateOne(
        { _id: user._id },
        {
          $set: { passwordHash },
          $inc: { authVersion: 1 },
          $unset: {
            passwordRecoveryHash: '',
            passwordRecoveryExpiresAt: '',
            passwordRecoveryVersion: '',
          },
        },
        { session, runValidators: true },
      );
      await this.sessions.updateMany(
        { userId: user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { session },
      );
      await this.audit.passwordRecovery('PASSWORD_RESET', user._id, session);
    });
    return { success: true };
  }
}
