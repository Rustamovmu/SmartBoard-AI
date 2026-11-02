import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const DEVICE_MODEL = 'EnrolledDevice';

@Schema({
  collection: 'devices',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class Device {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true }) userId: string;
  @Prop({ required: true, maxlength: 80 }) label: string;
  @Prop({ type: String, enum: ['ANDROID', 'IOS'], required: true }) platform:
    'ANDROID' | 'IOS';
  @Prop({ type: String, enum: ['ACTIVE', 'REVOKED'], required: true }) status:
    'ACTIVE' | 'REVOKED';
  @Prop({ required: true }) createdAt: Date;
  @Prop({ type: Date, default: null }) revokedAt: Date | null;
}
export const DeviceSchema = SchemaFactory.createForClass(Device);
DeviceSchema.index(
  { userId: 1, status: 1, createdAt: -1, _id: 1 },
  { name: 'device_owner_status' },
);
