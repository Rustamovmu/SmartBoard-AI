import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const AUTH_ATTEMPT_MODEL = 'AuthAttempt';
@Schema({
  collection: 'authAttempts',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class AuthAttempt {
  @Prop({ type: String, required: true })
  _id: string;
  @Prop({ required: true })
  count: number;
  @Prop({ required: true })
  expiresAt: Date;
}
export const AuthAttemptSchema = SchemaFactory.createForClass(AuthAttempt);
AuthAttemptSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'attempt_expiry' },
);
