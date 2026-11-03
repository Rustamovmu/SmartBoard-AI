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
export enum HelpKind {
  FAQ = 'FAQ',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
}
export enum HelpState {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}
export enum HelpTopic {
  GENERAL = 'GENERAL',
  ACCOUNTS = 'ACCOUNTS',
  DEVICES = 'DEVICES',
  LOCAL_STORAGE = 'LOCAL_STORAGE',
  PRIVACY = 'PRIVACY',
  OTHER = 'OTHER',
}
registerEnumType(HelpKind, { name: 'HelpKind' });
registerEnumType(HelpState, { name: 'HelpState' });
registerEnumType(HelpTopic, { name: 'HelpTopic' });
@InputType()
export class HelpEntriesInput {
  @Field(() => HelpKind) @IsEnum(HelpKind) kind: HelpKind;
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) @Max(10000) page = 1;
  @Field(() => Int, { defaultValue: 20 }) @IsInt() @Min(1) @Max(100) pageSize =
    20;
  @Field(() => HelpTopic, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(HelpTopic)
  topic?: HelpTopic;
}
@InputType()
export class AdminHelpEntriesInput extends HelpEntriesInput {
  @Field(() => HelpState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(HelpState)
  state?: HelpState;
}
@InputType()
export class CreateHelpEntryInput {
  @Field(() => HelpKind) @IsEnum(HelpKind) kind: HelpKind;
  @Field() @IsString() @MaxLength(160) title: string;
  @Field() @IsString() @MaxLength(16384) bodyMarkdown: string;
  @Field(() => HelpTopic, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(HelpTopic)
  topic?: HelpTopic;
  @Field(() => Int, { defaultValue: 0 }) @IsInt() @Min(0) @Max(1000000) order =
    0;
}
@InputType()
export class UpdateHelpEntryInput {
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
  @MaxLength(16384)
  bodyMarkdown?: string;
  @Field(() => HelpTopic, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(HelpTopic)
  topic?: HelpTopic;
  @Field(() => Int, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(1000000)
  order?: number;
  @Field(() => HelpState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(HelpState)
  state?: HelpState;
}
@ObjectType()
export class PublishedHelpSummary {
  @Field(() => ID) id: string;
  @Field(() => HelpKind) kind: HelpKind;
  @Field() title: string;
  @Field(() => HelpTopic, { nullable: true }) topic: HelpTopic | null;
  @Field(() => Int) order: number;
  @Field() publishedAt: string;
  @Field() updatedAt: string;
}
@ObjectType()
export class PublishedHelpEntry extends PublishedHelpSummary {
  @Field() bodyMarkdown: string;
}
@ObjectType()
export class PublishedHelpPage {
  @Field(() => [PublishedHelpSummary]) items: PublishedHelpSummary[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
@ObjectType()
export class AdminHelpEntry {
  @Field(() => ID) id: string;
  @Field(() => HelpKind) kind: HelpKind;
  @Field() title: string;
  @Field() bodyMarkdown: string;
  @Field(() => HelpTopic, { nullable: true }) topic: HelpTopic | null;
  @Field(() => Int) order: number;
  @Field(() => HelpState) state: HelpState;
  @Field(() => Int) revision: number;
  @Field(() => ID) createdByUserId: string;
  @Field(() => ID) updatedByUserId: string;
  @Field() createdAt: string;
  @Field() updatedAt: string;
  @Field(() => String, { nullable: true }) publishedAt: string | null;
}
@ObjectType()
export class AdminHelpPage {
  @Field(() => [AdminHelpEntry]) items: AdminHelpEntry[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
