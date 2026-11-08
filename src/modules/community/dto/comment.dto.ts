import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CommunityPostsInput,
  CommunityReason,
  CommunityState,
  CommunityModerationAction,
} from './community.dto';

@InputType()
export class CommunityCommentsInput extends CommunityPostsInput {
  @Field(() => ID) @IsUUID('4') postId: string;
}
@InputType()
export class ManagedCommunityCommentsInput extends CommunityPostsInput {
  @Field(() => ID, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID('4')
  postId?: string;
  @Field(() => CommunityState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CommunityState)
  state?: CommunityState;
}
@InputType()
export class CreateCommunityCommentInput {
  @Field(() => ID) @IsUUID('4') postId: string;
  @Field() @IsString() @MaxLength(80) publicDisplayName: string;
  @Field() @IsString() @MaxLength(4096) bodyMarkdown: string;
}
@InputType()
export class UpdateCommunityCommentInput {
  @Field(() => ID) @IsUUID('4') id: string;
  @Field(() => Int) @IsInt() @Min(1) expectedRevision: number;
  @Field({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(80)
  publicDisplayName?: string;
  @Field({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(4096)
  bodyMarkdown?: string;
  @Field(() => CommunityState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CommunityState)
  state?: CommunityState;
}
@InputType()
export class ModerateCommunityCommentInput {
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
export class PublishedCommunityComment {
  @Field(() => ID) id: string;
  @Field(() => ID) postId: string;
  @Field() publicDisplayName: string;
  @Field() bodyMarkdown: string;
  @Field() publishedAt: string;
  @Field() updatedAt: string;
}
@ObjectType()
export class ManagedCommunityComment {
  @Field(() => ID) id: string;
  @Field(() => ID) postId: string;
  @Field(() => ID) authorUserId: string;
  @Field() publicDisplayName: string;
  @Field() bodyMarkdown: string;
  @Field(() => CommunityState) state: CommunityState;
  @Field(() => Int) revision: number;
  @Field() createdAt: string;
  @Field() updatedAt: string;
  @Field() publishedAt: string;
  @Field(() => String, { nullable: true }) removedAt: string | null;
  @Field(() => CommunityReason, { nullable: true })
  removalReason: CommunityReason | null;
}
@ObjectType()
export class PublishedCommunityCommentsPage {
  @Field(() => [PublishedCommunityComment]) items: PublishedCommunityComment[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
@ObjectType()
export class ManagedCommunityCommentsPage {
  @Field(() => [ManagedCommunityComment]) items: ManagedCommunityComment[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
