import { UnauthorizedException } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { Account } from '../admin/dto/account.dto';
import { SetMyUsernameInput } from './dto/username.dto';
import { UsernameService } from './username.service';
@Resolver()
export class UsernameResolver {
  constructor(private readonly usernames: UsernameService) {}
  @Mutation(() => Account)
  setMyUsername(
    @Args('input') input: SetMyUsernameInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    if (!ctx.req.account) throw new UnauthorizedException();
    return this.usernames.set(
      input,
      ctx.credential,
      ctx.req.authTransport,
      ctx.req.account.user._id,
    );
  }
}
