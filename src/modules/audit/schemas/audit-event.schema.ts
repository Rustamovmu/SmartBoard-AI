import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
export const AUDIT_MODEL = 'PlatformAuditEvent';

@Schema({
  collection: 'auditEvents',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class AuditEvent {
  @Prop({ type: String, required: true })
  _id: string;
  @Prop({
    type: String,
    enum: [
      'ADMIN_BOOTSTRAPPED',
      'ACCOUNT_ACCESS_CHANGED',
      'DEVICE_ENROLLED',
      'DEVICE_REVOKED',
    ],
    required: true,
  })
  action: string;
  @Prop({
    type: String,
    enum: ['LOCAL_COMMAND', 'ADMIN', 'USER'],
    required: true,
  })
  actorType: string;
  @Prop({ type: String })
  actorUserId?: string;
  @Prop({ type: String })
  subjectDeviceId?: string;
  @Prop({ type: String, enum: ['USER', 'ADMIN'] })
  previousRole?: string;
  @Prop({ type: String, enum: ['USER', 'ADMIN'] })
  nextRole?: string;
  @Prop({ type: String, enum: ['ACTIVE', 'BLOCKED', 'DELETED'] })
  previousStatus?: string;
  @Prop({ type: String, enum: ['ACTIVE', 'BLOCKED', 'DELETED'] })
  nextStatus?: string;
  @Prop({ required: true })
  subjectUserId: string;
  @Prop({ required: true })
  createdAt: Date;
}
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ createdAt: -1 });
