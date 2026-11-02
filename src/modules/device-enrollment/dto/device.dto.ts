import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}
export enum DeviceState {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}
registerEnumType(DevicePlatform, { name: 'DevicePlatform' });
registerEnumType(DeviceState, { name: 'DeviceState' });

@ObjectType()
export class EnrolledDevice {
  @Field(() => ID) id: string;
  @Field(() => ID) userId: string;
  @Field() label: string;
  @Field(() => DevicePlatform) platform: DevicePlatform;
  @Field(() => DeviceState) status: DeviceState;
  @Field() createdAt: string;
  @Field(() => String, { nullable: true }) revokedAt: string | null;
}
@ObjectType()
export class DevicePage {
  @Field(() => [EnrolledDevice]) items: EnrolledDevice[];
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) total: number;
}
@ObjectType()
export class DevicePairing {
  @Field() code: string;
  @Field() expiresAt: string;
}
@InputType()
export class CreateDevicePairingInput {
  @Field()
  @IsString()
  @Length(1, 80)
  @Matches(/^[\p{L}\p{N}][\p{L}\p{N} ._()-]*$/u)
  label: string;
  @Field(() => DevicePlatform) @IsEnum(DevicePlatform) platform: DevicePlatform;
}
@InputType()
export class ConfirmDevicePairingInput {
  @Field() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) code: string;
}
@InputType()
export class DevicesInput {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) @Max(10000) page = 1;
  @Field(() => Int, { defaultValue: 20 }) @IsInt() @Min(1) @Max(100) pageSize =
    20;
  @Field(() => DeviceState, { nullable: true })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(DeviceState)
  status?: DeviceState;
}
@InputType()
export class AdminDevicesInput extends DevicesInput {
  @Field(() => ID) @IsUUID('4') userId: string;
}
@InputType()
export class RevokeDeviceInput {
  @Field(() => ID) @IsUUID('4') id: string;
}

@InputType()
export class RevokeDevicesInput {
  @Field(() => [ID])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids: string[];
}
