import { USERNAME_PATTERN } from '../../../contracts/username-v1';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Length(1, 254)
  identifier?: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

export class SignupDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @Matches(USERNAME_PATTERN)
  username?: string;

  @IsString()
  @Length(12, 128)
  password: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  @Matches(/\S/)
  name: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(/^sb_p\.[A-Za-z0-9_-]{43}$/)
  recoveryToken: string;

  @IsString()
  @Length(12, 128)
  password: string;
}
