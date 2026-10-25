import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { AccountStatus, MemberRole } from '../../../contracts/auth-v1';

export const MEMBER_MODEL = 'PlatformMember';

@Schema({
  collection: 'users',
  timestamps: true,
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class Member {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, maxlength: 254 })
  email: string;

  @Prop({ required: true, maxlength: 80 })
  name: string;

  @Prop({ required: true, select: false, maxlength: 256 })
  passwordHash: string;

  @Prop({
    type: String,
    enum: ['USER', 'ADMIN'],
    required: true,
    default: 'USER',
  })
  role: MemberRole;

  @Prop({
    type: String,
    enum: ['ACTIVE', 'BLOCKED', 'DELETED'],
    required: true,
    default: 'ACTIVE',
  })
  status: AccountStatus;

  @Prop({ required: true, default: 0, select: false })
  authVersion: number;

  createdAt: Date;
  updatedAt: Date;
}

export const MemberSchema = SchemaFactory.createForClass(Member);
MemberSchema.index(
  { email: 1 },
  { unique: true, name: 'unique_normalized_email' },
);
