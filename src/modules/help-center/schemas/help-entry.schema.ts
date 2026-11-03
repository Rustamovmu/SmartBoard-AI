import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HelpKind, HelpState, HelpTopic } from '../dto/help.dto';
export const HELP_MODEL = 'PlatformHelpEntry';
@Schema({
  collection: 'helpEntries',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class HelpEntryRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ type: String, enum: Object.values(HelpKind), required: true })
  kind: HelpKind;
  @Prop({ required: true, maxlength: 160 }) title: string;
  @Prop({ required: true, maxlength: 16384 }) bodyMarkdown: string;
  @Prop({ type: String, enum: Object.values(HelpTopic), default: null })
  topic: HelpTopic | null;
  @Prop({ required: true, min: 0, max: 1000000 }) order: number;
  @Prop({ type: String, enum: Object.values(HelpState), required: true })
  state: HelpState;
  @Prop({ required: true, min: 1 }) revision: number;
  @Prop({ required: true }) createdByUserId: string;
  @Prop({ required: true }) updatedByUserId: string;
  @Prop({ required: true }) createdAt: Date;
  @Prop({ required: true }) updatedAt: Date;
  @Prop({ type: Date, default: null }) publishedAt: Date | null;
}
export const HelpEntrySchema = SchemaFactory.createForClass(HelpEntryRecord);
export const HELP_INDEXES = [
  { kind: 1, state: 1, order: 1, createdAt: 1, _id: 1 },
  { kind: 1, state: 1, topic: 1, order: 1, createdAt: 1, _id: 1 },
  { kind: 1, state: 1, order: 1, publishedAt: -1, _id: 1 },
  { kind: 1, state: 1, updatedAt: -1, _id: 1 },
  { kind: 1, updatedAt: -1, _id: 1 },
] as const;
for (const index of HELP_INDEXES) HelpEntrySchema.index(index);
