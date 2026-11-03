import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { CommunityService } from './community.service';
import {
  CommunityPostsInput,
  ManagedCommunityPostsInput,
  CreateCommunityPostInput,
  UpdateCommunityPostInput,
  ModerateCommunityPostInput,
  PublishedCommunityPage,
  PublishedCommunityPost,
  ManagedCommunityPage,
  ManagedCommunityPost,
} from './dto/community.dto';
@Resolver()
export class CommunityResolver {
  constructor(private readonly community: CommunityService) {}
  private actor(ctx: PlatformGraphqlContext) {
    if (!ctx.req.account) throw new UnauthorizedException();
    return {
      credential: ctx.credential,
      transport: ctx.req.authTransport,
      id: ctx.req.account.user._id,
    };
  }
  @Query(() => PublishedCommunityPage) communityPosts(
    @Args('input') input: CommunityPostsInput,
  ) {
    return this.community.list(input, 'public');
  }
  @Query(() => PublishedCommunityPost) communityPost(
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.community.get(id, 'public');
  }
  @Query(() => ManagedCommunityPage) myCommunityPosts(
    @Args('input') input: ManagedCommunityPostsInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.community.list(input, 'owner', this.actor(ctx).id);
  }
  @Query(() => ManagedCommunityPost) myCommunityPost(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.community.get(id, 'owner', this.actor(ctx).id);
  }
  @Mutation(() => ManagedCommunityPost) createCommunityPost(
    @Args('input') input: CreateCommunityPostInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.community.create(input, this.actor(ctx));
  }
  @Mutation(() => ManagedCommunityPost) updateCommunityPost(
    @Args('input') input: UpdateCommunityPostInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.community.update(input, this.actor(ctx));
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => ManagedCommunityPage)
  adminCommunityPosts(@Args('input') input: ManagedCommunityPostsInput) {
    return this.community.list(input, 'admin');
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => ManagedCommunityPost)
  adminCommunityPost(@Args('id', { type: () => ID }) id: string) {
    return this.community.get(id, 'admin');
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => ManagedCommunityPost)
  adminModerateCommunityPost(
    @Args('input') input: ModerateCommunityPostInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.community.moderate(input, this.actor(ctx));
  }
}
