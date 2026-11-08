import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { CommentService } from './comment.service';
import {
  CommunityCommentsInput,
  ManagedCommunityCommentsInput,
  CreateCommunityCommentInput,
  UpdateCommunityCommentInput,
  ModerateCommunityCommentInput,
  PublishedCommunityCommentsPage,
  ManagedCommunityCommentsPage,
  ManagedCommunityComment,
} from './dto/comment.dto';
@Resolver()
export class CommentResolver {
  constructor(private readonly comments: CommentService) {}
  private actor(ctx: PlatformGraphqlContext) {
    if (!ctx.req.account) throw new UnauthorizedException();
    return {
      credential: ctx.credential,
      transport: ctx.req.authTransport,
      id: ctx.req.account.user._id,
    };
  }
  @Query(() => PublishedCommunityCommentsPage) communityComments(
    @Args('input') input: CommunityCommentsInput,
  ) {
    return this.comments.published(input);
  }
  @Query(() => ManagedCommunityCommentsPage) myCommunityComments(
    @Args('input') input: ManagedCommunityCommentsInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.comments.list(input, this.actor(ctx).id);
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => ManagedCommunityCommentsPage)
  adminCommunityComments(@Args('input') input: ManagedCommunityCommentsInput) {
    return this.comments.list(input);
  }
  @Query(() => ManagedCommunityComment)
  myCommunityComment(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.comments.get(id, this.actor(ctx).id);
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => ManagedCommunityComment)
  adminCommunityComment(@Args('id', { type: () => ID }) id: string) {
    return this.comments.get(id);
  }
  @Mutation(() => ManagedCommunityComment) createCommunityComment(
    @Args('input') input: CreateCommunityCommentInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.comments.create(input, this.actor(ctx));
  }
  @Mutation(() => ManagedCommunityComment) updateCommunityComment(
    @Args('input') input: UpdateCommunityCommentInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.comments.update(input, this.actor(ctx));
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => ManagedCommunityComment)
  adminModerateCommunityComment(
    @Args('input') input: ModerateCommunityCommentInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.comments.moderate(input, this.actor(ctx));
  }
}
