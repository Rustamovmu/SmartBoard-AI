import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const PAIRING_MODEL = 'DevicePairingRequest';

@Schema({
  collection: 'pairingRequests',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class PairingRequest {
  // One replaceable request per target auth session. Never a phone hardware ID.
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true }) userId: string;
  @Prop({ required: true, select: false }) codeHash: string;
  @Prop({ required: true, maxlength: 80 }) label: string;
  @Prop({ type: String, enum: ['ANDROID', 'IOS'], required: true }) platform:
    'ANDROID' | 'IOS';
  @Prop({ required: true }) expiresAt: Date;
  @Prop({ type: Date, default: null }) consumedAt: Date | null;
}
export const PairingRequestSchema =
  SchemaFactory.createForClass(PairingRequest);
PairingRequestSchema.index(
  { codeHash: 1 },
  { unique: true, name: 'pairing_code_unique' },
);
PairingRequestSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'pairing_expiry' },
);
