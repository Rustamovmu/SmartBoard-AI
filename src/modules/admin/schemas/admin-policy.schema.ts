import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const ADMIN_POLICY_MODEL = 'PlatformAdminPolicy';
export const ADMIN_POLICY_ID = 'admin-policy-v1';

/** A shared transactional write prevents last-admin count write skew. */
@Schema({
  collection: 'platformSettings',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class AdminPolicy {
  @Prop({ type: String, required: true, enum: [ADMIN_POLICY_ID] })
  _id: string;

  @Prop({ required: true, default: 0 })
  revision: number;
}
export const AdminPolicySchema = SchemaFactory.createForClass(AdminPolicy);
