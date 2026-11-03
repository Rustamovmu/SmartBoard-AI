import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CommunityState, CommunityReason } from '../dto/community.dto';
export const COMMUNITY_MODEL = 'PlatformCommunityPost';
@Schema({
  collection: 'communityPosts',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class CommunityPostRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true }) authorUserId: string;
  @Prop({ required: true, maxlength: 160 }) title: string;
  @Prop({ required: true, maxlength: 80 }) publicDisplayName: string;
  @Prop({ required: true, maxlength: 16384 }) bodyMarkdown: string;
  @Prop({ type: String, enum: Object.values(CommunityState), required: true })
  state: CommunityState;
  @Prop({ required: true, min: 1 }) revision: number;
  @Prop({ required: true }) createdAt: Date;
  @Prop({ required: true }) updatedAt: Date;
  @Prop({ type: Date, default: null }) publishedAt: Date | null;
  @Prop({ type: Date, default: null }) removedAt: Date | null;
  @Prop({ type: String, default: null }) removedByUserId: string | null;
  @Prop({ type: String, enum: Object.values(CommunityReason), default: null })
  removalReason: CommunityReason | null;
}
export const CommunityPostSchema =
  SchemaFactory.createForClass(CommunityPostRecord);
export const COMMUNITY_INDEXES = [
  { state: 1, publishedAt: -1, _id: 1 },
  { authorUserId: 1, updatedAt: -1, _id: 1 },
  { authorUserId: 1, state: 1, updatedAt: -1, _id: 1 },
  { state: 1, updatedAt: -1, _id: 1 },
  { updatedAt: -1, _id: 1 },
] as const;
for (const index of COMMUNITY_INDEXES) CommunityPostSchema.index(index);
