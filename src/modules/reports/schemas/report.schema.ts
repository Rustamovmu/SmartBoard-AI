import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CommunityReason } from '../../community/dto/community.dto';
import { ReportState, ReportTarget } from '../dto/report.dto';
export const REPORT_MODEL = 'PlatformCommunityReport';
@Schema({
  collection: 'reports',
  strict: 'throw',
  autoCreate: false,
  autoIndex: false,
})
export class CommunityReportRecord {
  @Prop({ type: String, required: true }) _id: string;
  @Prop({ required: true }) reporterUserId: string;
  @Prop({ type: String, enum: Object.values(ReportTarget), required: true })
  targetType: ReportTarget;
  @Prop({ required: true }) targetId: string;
  @Prop({ required: true }) postId: string;
  @Prop({ type: String, enum: Object.values(CommunityReason), required: true })
  reason: CommunityReason;
  @Prop({ type: String, enum: Object.values(ReportState), required: true })
  state: ReportState;
  @Prop({ required: true, min: 1 }) revision: number;
  @Prop({ required: true }) createdAt: Date;
  @Prop({ required: true }) updatedAt: Date;
  @Prop({ type: String, default: null }) reviewedByUserId: string | null;
}
export const CommunityReportSchema = SchemaFactory.createForClass(
  CommunityReportRecord,
);
export const REPORT_UNIQUE_INDEX = {
  reporterUserId: 1,
  targetType: 1,
  targetId: 1,
} as const;
CommunityReportSchema.index(REPORT_UNIQUE_INDEX, { unique: true });
export const REPORT_INDEXES = [
  { reporterUserId: 1, updatedAt: -1, _id: 1 },
  { state: 1, updatedAt: -1, _id: 1 },
  { targetType: 1, state: 1, updatedAt: -1, _id: 1 },
  { updatedAt: -1, _id: 1 },
] as const;
for (const index of REPORT_INDEXES) CommunityReportSchema.index(index);
