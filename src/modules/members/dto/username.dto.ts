import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { USERNAME_PATTERN } from '../../../contracts/username-v1';
@InputType()
export class SetMyUsernameInput {
  @Field()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(USERNAME_PATTERN)
  username: string;
}
