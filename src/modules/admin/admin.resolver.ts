import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { MembersService } from '../members/members.service';
import { AdminService } from './admin.service';
import {
  Account,
  AccountPage,
  AccountsInput,
  UpdateAccountAccessInput,
} from './dto/account.dto';

@Resolver()
export class AdminResolver {
  constructor(
    private readonly admin: AdminService,
    private readonly members: MembersService,
  ) {}

  @Query(() => Account)
  currentAccount(@Context() { req }: PlatformGraphqlContext) {
    return this.members.publicMember(req.account.user);
  }

  @UseGuards(GraphqlAdminGuard)
  @Query(() => AccountPage)
  adminAccounts(@Args('input') input: AccountsInput) {
    return this.admin.accounts(input);
  }

  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => Account)
  adminUpdateAccountAccess(
    @Args('input') input: UpdateAccountAccessInput,
    @Context() context: PlatformGraphqlContext,
  ) {
    return this.admin.updateAccess(
      input,
      context.credential,
      context.req.authTransport,
    );
  }
}
