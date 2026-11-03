import { UseGuards } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { HelpService } from './help.service';
import {
  AdminHelpEntry,
  AdminHelpEntriesInput,
  AdminHelpPage,
  CreateHelpEntryInput,
  HelpEntriesInput,
  PublishedHelpEntry,
  PublishedHelpPage,
  UpdateHelpEntryInput,
} from './dto/help.dto';
@Resolver()
export class HelpResolver {
  constructor(private readonly help: HelpService) {}
  @Query(() => PublishedHelpPage) helpEntries(
    @Args('input') input: HelpEntriesInput,
  ) {
    return this.help.list(input);
  }
  @Query(() => PublishedHelpEntry) helpEntry(
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.help.get(id);
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => AdminHelpPage)
  adminHelpEntries(@Args('input') input: AdminHelpEntriesInput) {
    return this.help.list(input, true);
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => AdminHelpEntry)
  adminHelpEntry(@Args('id', { type: () => ID }) id: string) {
    return this.help.get(id, true);
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => AdminHelpEntry)
  adminCreateHelpEntry(
    @Args('input') input: CreateHelpEntryInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.help.create(
      input,
      ctx.credential,
      ctx.req.authTransport,
      ctx.req.account.user._id,
    );
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => AdminHelpEntry)
  adminUpdateHelpEntry(
    @Args('input') input: UpdateHelpEntryInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.help.update(
      input,
      ctx.credential,
      ctx.req.authTransport,
      ctx.req.account.user._id,
    );
  }
}
