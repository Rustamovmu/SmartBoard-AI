import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export enum CommunityState {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  REMOVED = 'REMOVED',
}
export enum CommunityReason {
  SPAM = 'SPAM',
  ABUSE = 'ABUSE',
  PRIVACY = 'PRIVACY',
  OFF_TOPIC = 'OFF_TOPIC',
  OTHER = 'OTHER',
}
export enum CommunityModerationAction {
  REMOVE = 'REMOVE',
  RESTORE = 'RESTORE',
}
registerEnumType(CommunityState, { name: 'CommunityState' });
registerEnumType(CommunityReason, { name: 'CommunityReason' });
registerEnumType(CommunityModerationAction, {
  name: 'CommunityModerationAction',
});

@InputType()
export class CommunityPostsInput {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) @Max(10000) page = 1;
  @Field(() => Int, { defaultValue: 20 }) @IsInt() @Min(1) @Max(100) pageSize =
    20;
}
@InputType()
export class ManagedCommunityPostsInput extends CommunityPostsInput {
  @Field(() => CommunityState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CommunityState)
  state?: CommunityState;
}
@InputType()
export class CreateCommunityPostInput {
  @Field() @IsString() @MaxLength(160) title: string;
  @Field() @IsString() @MaxLength(80) publicDisplayName: string;
  @Field() @IsString() @MaxLength(16384) bodyMarkdown: string;
}
@InputType()
export class UpdateCommunityPostInput {
  @Field(() => ID) @IsUUID('4') id: string;
  @Field(() => Int) @IsInt() @Min(1) expectedRevision: number;
  @Field({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(160)
  title?: string;
  @Field({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(80)
  publicDisplayName?: string;
  @Field({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(16384)
  bodyMarkdown?: string;
  @Field(() => CommunityState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CommunityState)
  state?: CommunityState;
}
@InputType()
export class ModerateCommunityPostInput {
  @Field(() => ID) @IsUUID('4') id: string;
  @Field(() => Int) @IsInt() @Min(1) expectedRevision: number;
  @Field(() => CommunityModerationAction)
  @IsEnum(CommunityModerationAction)
  action: CommunityModerationAction;
  @Field(() => CommunityReason, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CommunityReason)
  reason?: CommunityReason;
}
@ObjectType()
export class PublishedCommunitySummary {
  @Field(() => ID) id: string;
  @Field() title: string;
  @Field() publicDisplayName: string;
  @Field() publishedAt: string;
  @Field() updatedAt: string;
}
@ObjectType()
export class PublishedCommunityPost extends PublishedCommunitySummary {
  @Field() bodyMarkdown: string;
}
@ObjectType()
export class PublishedCommunityPage {
  @Field(() => [PublishedCommunitySummary]) items: PublishedCommunitySummary[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
@ObjectType()
export class ManagedCommunityPost {
  @Field(() => ID) id: string;
  @Field(() => ID) authorUserId: string;
  @Field() title: string;
  @Field() publicDisplayName: string;
  @Field() bodyMarkdown: string;
  @Field(() => CommunityState) state: CommunityState;
  @Field(() => Int) revision: number;
  @Field() createdAt: string;
  @Field() updatedAt: string;
  @Field(() => String, { nullable: true }) publishedAt: string | null;
  @Field(() => String, { nullable: true }) removedAt: string | null;
  @Field(() => CommunityReason, { nullable: true })
  removalReason: CommunityReason | null;
}
@ObjectType()
export class ManagedCommunityPage {
  @Field(() => [ManagedCommunityPost]) items: ManagedCommunityPost[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
