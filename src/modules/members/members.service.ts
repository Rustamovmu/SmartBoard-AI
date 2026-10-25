import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Model } from 'mongoose';
import type { MemberRole, PublicMember } from '../../contracts/auth-v1';
import { MEMBER_MODEL, Member } from './schemas/member.schema';

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(MEMBER_MODEL) private readonly members: Model<Member>,
  ) {}

  async create(
    input: { email: string; name: string; passwordHash: string },
    role: MemberRole,
    session: ClientSession,
  ) {
    try {
      const [member] = await this.members.create(
        [
          {
            _id: randomUUID(),
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
            role,
            status: 'ACTIVE',
            authVersion: 0,
          },
        ],
        { session },
      );
      return member.toObject();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException();
      }
      throw error;
    }
  }

  findCredentials(email: string) {
    return this.members
      .findOne({ email })
      .select('+passwordHash +authVersion')
      .lean()
      .exec();
  }

  findCurrent(id: string, session?: ClientSession) {
    return this.members
      .findById(id)
      .select('+authVersion')
      .session(session ?? null)
      .lean()
      .exec();
  }

  publicMember(member: Member): PublicMember {
    return {
      id: member._id,
      email: member.email,
      name: member.name,
      role: member.role,
      status: member.status,
      createdAt: member.createdAt.toISOString(),
    };
  }
}
