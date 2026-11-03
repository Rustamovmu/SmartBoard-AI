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
      'PASSWORD_RECOVERY_ISSUED',
      'PASSWORD_RESET',
      'HELP_ENTRY_CHANGED',
      'COMMUNITY_POST_CHANGED',
    ],
    required: true,
  })
  action: string;
  @Prop({
    type: String,
    enum: ['LOCAL_COMMAND', 'ADMIN', 'USER', 'RECOVERY_CREDENTIAL'],
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
  @Prop({
    type: String,
    required: function (this: AuditEvent) {
      return !['HELP_ENTRY_CHANGED', 'COMMUNITY_POST_CHANGED'].includes(
        this.action,
      );
    },
  })
  subjectUserId?: string;
  @Prop({
    type: String,
    required: function (this: AuditEvent) {
      return this.action === 'HELP_ENTRY_CHANGED';
    },
  })
  subjectHelpEntryId?: string;
  @Prop({ type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  previousHelpState?: string;
  @Prop({ type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  nextHelpState?: string;
  @Prop({ type: Number }) helpRevision?: number;
  @Prop({
    type: String,
    required: function (this: AuditEvent) {
      return this.action === 'COMMUNITY_POST_CHANGED';
    },
  })
  subjectCommunityPostId?: string;
  @Prop({ type: String, enum: ['CREATE', 'UPDATE', 'REMOVE', 'RESTORE'] })
  communityAction?: string;
  @Prop({ type: String, enum: ['DRAFT', 'PUBLISHED', 'REMOVED'] })
  previousCommunityState?: string;
  @Prop({ type: String, enum: ['DRAFT', 'PUBLISHED', 'REMOVED'] })
  nextCommunityState?: string;
  @Prop({ type: Number }) communityRevision?: number;
  @Prop({
    type: String,
    enum: ['SPAM', 'ABUSE', 'PRIVACY', 'OFF_TOPIC', 'OTHER'],
  })
  communityReason?: string;
  @Prop({ required: true })
  createdAt: Date;
}
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ createdAt: -1 });
