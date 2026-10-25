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
  @Prop({ type: String, enum: ['ADMIN_BOOTSTRAPPED'], required: true })
  action: string;
  @Prop({ type: String, enum: ['LOCAL_COMMAND'], required: true })
  actorType: string;
  @Prop({ required: true })
  subjectUserId: string;
  @Prop({ required: true })
  createdAt: Date;
}
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ createdAt: -1 });
