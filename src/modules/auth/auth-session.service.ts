import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import { AUTH_POLICY, type AuthTransport } from '../../contracts/auth-v1';
import { MembersService } from '../members/members.service';
import type { Member } from '../members/schemas/member.schema';
import { AUTH_SESSION_MODEL, AuthSession } from './schemas/auth-session.schema';
import { digest, matchesHash, TokenService } from './token.service';

export interface SessionGrant {
  user: Member;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  sessionExpiresAt: Date;
}
const secretFields = '+accessHash +refreshHash +refreshFamilyHash';

@Injectable()
export class AuthSessionService {
  constructor(
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    @InjectConnection() private readonly connection: Connection,
    private readonly members: MembersService,
    private readonly tokens: TokenService,
  ) {}

  async create(
    user: Member,
    transport: AuthTransport,
    transaction: ClientSession,
  ): Promise<SessionGrant> {
    const id = randomUUID();
    const now = Date.now();
    const accessExpiresAt = new Date(now + AUTH_POLICY.accessLifetimeMs);
    const sessionExpiresAt = new Date(now + AUTH_POLICY.sessionLifetimeMs);
    const family = this.tokens.secret();
    const accessToken = this.tokens.access(id);
    const refreshToken = this.tokens.refresh(id, family);
    await this.sessions.create(
      [
        {
          _id: id,
          familyId: id,
          userId: user._id,
          transport,
          accessHash: digest(accessToken),
          refreshHash: digest(refreshToken),
          refreshFamilyHash: digest(family),
          accessExpiresAt,
          expiresAt: sessionExpiresAt,
          revokedAt: null,
          accountVersion: user.authVersion,
        },
      ],
      { session: transaction },
    );
    return {
      user,
      accessToken,
      refreshToken,
      accessExpiresAt,
      sessionExpiresAt,
    };
  }

  private async currentUser(record: AuthSession, transaction?: ClientSession) {
    const user = await this.members.findCurrent(record.userId, transaction);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.authVersion !== record.accountVersion
    ) {
      // All old sessions remain unusable even if an account is later reactivated.
      await this.sessions
        .updateMany(
          { userId: record.userId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        )
        .session(transaction ?? null)
        .exec();
      return null;
    }
    return user;
  }

  async authenticate(raw: string, transport: AuthTransport) {
    const { id } = this.tokens.parseAccess(raw);
    const record = await this.sessions
      .findById(id)
      .select(secretFields)
      .lean()
      .exec();
    if (
      !record ||
      record.transport !== transport ||
      record.revokedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      record.accessExpiresAt.getTime() <= Date.now() ||
      !matchesHash(raw, record.accessHash)
    ) {
      throw new UnauthorizedException();
    }
    const user = await this.currentUser(record);
    if (!user) throw new ForbiddenException();
    return { user, sessionId: id };
  }

  async rotate(raw: string, transport: AuthTransport): Promise<SessionGrant> {
    const { id, familySecret } = this.tokens.parseRefresh(raw);
    // Return a rejected outcome rather than throw inside the transaction, so
    // replay/account revocations commit before the HTTP rejection is emitted.
    const outcome = await this.connection.transaction(async (transaction) => {
      const record = await this.sessions
        .findById(id)
        .select(secretFields)
        .session(transaction)
        .lean()
        .exec();
      if (
        !record ||
        record.transport !== transport ||
        record.revokedAt ||
        record.expiresAt.getTime() <= Date.now() ||
        !matchesHash(familySecret, record.refreshFamilyHash)
      )
        return null;
      if (!matchesHash(raw, record.refreshHash)) {
        await this.sessions
          .updateOne({ _id: id }, { $set: { revokedAt: new Date() } })
          .session(transaction)
          .exec();
        return null;
      }
      const user = await this.currentUser(record, transaction);
      if (!user) return null;
      const accessToken = this.tokens.access(id);
      const refreshToken = this.tokens.refresh(id, familySecret);
      const accessExpiresAt = new Date(
        Math.min(
          Date.now() + AUTH_POLICY.accessLifetimeMs,
          record.expiresAt.getTime(),
        ),
      );
      const changed = await this.sessions
        .updateOne(
          { _id: id, refreshHash: record.refreshHash, revokedAt: null },
          {
            $set: {
              refreshHash: digest(refreshToken),
              accessHash: digest(accessToken),
              accessExpiresAt,
            },
          },
        )
        .session(transaction)
        .exec();
      if (changed.modifiedCount !== 1) return null;
      return {
        user,
        accessToken,
        refreshToken,
        accessExpiresAt,
        sessionExpiresAt: record.expiresAt,
      };
    });
    if (!outcome) throw new UnauthorizedException();
    return outcome;
  }

  async logout(raw: string | undefined, transport: AuthTransport) {
    if (!raw) return;
    let parsed: { id: string; familySecret: string };
    try {
      parsed = this.tokens.parseRefresh(raw);
    } catch {
      return;
    }
    const record = await this.sessions
      .findById(parsed.id)
      .select(secretFields)
      .lean()
      .exec();
    if (
      !record ||
      record.transport !== transport ||
      !matchesHash(parsed.familySecret, record.refreshFamilyHash)
    )
      return;
    await this.sessions
      .updateOne(
        { _id: record._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }
}
