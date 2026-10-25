import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MEMBER_MODEL, Member } from '../members/schemas/member.schema';
import { AUTH_SESSION_MODEL, AuthSession } from './schemas/auth-session.schema';
import { AUTH_ATTEMPT_MODEL, AuthAttempt } from './schemas/auth-attempt.schema';

@Injectable()
export class AuthSchemaService {
  constructor(
    @InjectModel(MEMBER_MODEL) private readonly members: Model<Member>,
    @InjectModel(AUTH_SESSION_MODEL)
    private readonly sessions: Model<AuthSession>,
    @InjectModel(AUTH_ATTEMPT_MODEL)
    private readonly attempts: Model<AuthAttempt>,
  ) {}

  async assertPrepared() {
    try {
      const [users, sessions, attempts] = await Promise.all([
        this.members.listIndexes(),
        this.sessions.listIndexes(),
        this.attempts.listIndexes(),
      ]);
      if (
        !users.some(
          (index) =>
            index.unique === true &&
            index.key.email === 1 &&
            Object.keys(index.key).length === 1,
        ) ||
        !sessions.some(
          (index) =>
            index.key.expiresAt === 1 && index.expireAfterSeconds === 0,
        ) ||
        !attempts.some(
          (index) =>
            index.key.expiresAt === 1 && index.expireAfterSeconds === 0,
        )
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  /** Explicit local setup only. No HTTP endpoint calls this; never drops indexes. */
  async prepare() {
    await this.members.createCollection();
    await this.members.createIndexes();
    await this.sessions.createCollection();
    await this.sessions.createIndexes();
    await this.attempts.createCollection();
    await this.attempts.createIndexes();
    await this.assertPrepared();
  }
}
