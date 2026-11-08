import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsEnum, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import {
  CommunityPostsInput,
  CommunityReason,
} from '../../community/dto/community.dto';
export enum ReportTarget {
  POST = 'POST',
  COMMENT = 'COMMENT',
}
export enum ReportState {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}
registerEnumType(ReportTarget, { name: 'ReportTarget' });
registerEnumType(ReportState, { name: 'ReportState' });
@InputType()
export class CreateCommunityReportInput {
  @Field(() => ReportTarget) @IsEnum(ReportTarget) targetType: ReportTarget;
  @Field(() => ID) @IsUUID('4') targetId: string;
  @Field(() => CommunityReason)
  @IsEnum(CommunityReason)
  reason: CommunityReason;
}
@InputType()
export class CommunityReportsInput extends CommunityPostsInput {
  @Field(() => ReportState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(ReportState)
  state?: ReportState;
  @Field(() => ReportTarget, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(ReportTarget)
  targetType?: ReportTarget;
}
@InputType()
export class ReviewCommunityReportInput {
  @Field(() => ID) @IsUUID('4') id: string;
  @Field(() => Int) @IsInt() @Min(1) expectedRevision: number;
  @Field(() => ReportState) @IsEnum(ReportState) state: ReportState;
}
@ObjectType()
export class CommunityReport {
  @Field(() => ID) id: string;
  @Field(() => ReportTarget) targetType: ReportTarget;
  @Field(() => ID) targetId: string;
  @Field(() => ID) postId: string;
  @Field(() => CommunityReason) reason: CommunityReason;
  @Field(() => ReportState) state: ReportState;
  @Field(() => Int) revision: number;
  @Field() createdAt: string;
  @Field() updatedAt: string;
}
@ObjectType()
export class CommunityReportsPage {
  @Field(() => [CommunityReport]) items: CommunityReport[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
