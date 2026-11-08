import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import type { PublicMember } from '../../../contracts/auth-v1';

export enum AccountRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}
export enum AccountState {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  DELETED = 'DELETED',
}
registerEnumType(AccountRole, { name: 'AccountRole' });
registerEnumType(AccountState, { name: 'AccountState' });

@ObjectType()
export class Account implements PublicMember {
  @Field(() => ID) id: string;
  @Field() email: string;
  @Field(() => String, { nullable: true }) username: string | null;
  @Field() name: string;
  @Field(() => AccountRole) role: PublicMember['role'];
  @Field(() => AccountState) status: PublicMember['status'];
  @Field() createdAt: string;
}

@ObjectType()
export class AccountPage {
  @Field(() => [Account]) items: Account[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}

@InputType()
export class AccountsInput {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) @Max(10000) page = 1;
  @Field(() => Int, { defaultValue: 20 }) @IsInt() @Min(1) @Max(100) pageSize =
    20;
  @Field(() => AccountRole, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(AccountRole)
  role?: AccountRole;
  @Field(() => AccountState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(AccountState)
  status?: AccountState;
}

@InputType()
export class UpdateAccountAccessInput {
  @Field(() => ID) @IsUUID('4') id: string;
  @Field(() => AccountRole, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(AccountRole)
  role?: AccountRole;
  @Field(() => AccountState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(AccountState)
  status?: AccountState;
}
