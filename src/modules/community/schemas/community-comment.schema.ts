import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CommunityState, CommunityReason } from '../dto/community.dto';
export const COMMENT_MODEL = 'PlatformCommunityComment';
@Schema({
  collection: 'communityComments',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class CommunityCommentRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true }) postId: string;
  @Prop({ required: true }) authorUserId: string;
  @Prop({ required: true, maxlength: 80 }) publicDisplayName: string;
  @Prop({ required: true, maxlength: 4096 }) bodyMarkdown: string;
  @Prop({ type: String, enum: Object.values(CommunityState), required: true })
  state: CommunityState;
  @Prop({ required: true, min: 1 }) revision: number;
  @Prop({ required: true }) createdAt: Date;
  @Prop({ required: true }) updatedAt: Date;
  @Prop({ required: true }) publishedAt: Date;
  @Prop({ type: Date, default: null }) removedAt: Date | null;
  @Prop({ type: String, default: null }) removedByUserId: string | null;
  @Prop({ type: String, enum: Object.values(CommunityReason), default: null })
  removalReason: CommunityReason | null;
}
export const CommunityCommentSchema = SchemaFactory.createForClass(
  CommunityCommentRecord,
);
export const COMMENT_INDEXES = [
  { postId: 1, state: 1, publishedAt: 1, _id: 1 },
  { authorUserId: 1, updatedAt: -1, _id: 1 },
  { authorUserId: 1, state: 1, updatedAt: -1, _id: 1 },
  { postId: 1, updatedAt: -1, _id: 1 },
  { state: 1, updatedAt: -1, _id: 1 },
  { updatedAt: -1, _id: 1 },
] as const;
for (const index of COMMENT_INDEXES) CommunityCommentSchema.index(index);
