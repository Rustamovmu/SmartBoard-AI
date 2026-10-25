import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { AuthTransport } from '../../../contracts/auth-v1';

export const AUTH_SESSION_MODEL = 'AuthSession';

@Schema({
  collection: 'authSessions',
  timestamps: true,
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class AuthSession {
  @Prop({ type: String, required: true })
  _id: string;
  @Prop({ required: true })
  userId: string;
  @Prop({ required: true })
  familyId: string;
  @Prop({ required: true, select: false })
  refreshFamilyHash: string;
  @Prop({ required: true, select: false })
  refreshHash: string;
  @Prop({ required: true, select: false })
  accessHash: string;
  @Prop({ required: true })
  accessExpiresAt: Date;
  @Prop({ required: true })
  expiresAt: Date;
  @Prop({ type: Date, default: null })
  revokedAt: Date | null;
  @Prop({ required: true })
  accountVersion: number;
  @Prop({ type: String, enum: ['browser', 'native'], required: true })
  transport: AuthTransport;
  createdAt: Date;
  updatedAt: Date;
}

export const AuthSessionSchema = SchemaFactory.createForClass(AuthSession);
AuthSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'session_expiry' },
);
AuthSessionSchema.index({ userId: 1, revokedAt: 1 });
