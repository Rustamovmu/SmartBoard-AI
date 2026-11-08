import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import type { PlatformGraphqlContext } from '../../graphql/graphql-context';
import { ReportsService } from './reports.service';
import {
  CreateCommunityReportInput,
  ReviewCommunityReportInput,
  CommunityReportsInput,
  CommunityReport,
  CommunityReportsPage,
} from './dto/report.dto';
@Resolver()
export class ReportsResolver {
  constructor(private readonly reports: ReportsService) {}
  private actor(ctx: PlatformGraphqlContext) {
    if (!ctx.req.account) throw new UnauthorizedException();
    return {
      credential: ctx.credential,
      transport: ctx.req.authTransport,
      id: ctx.req.account.user._id,
    };
  }
  @Query(() => CommunityReportsPage) myCommunityReports(
    @Args('input') input: CommunityReportsInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.reports.list(input, this.actor(ctx).id);
  }
  @Mutation(() => CommunityReport) createCommunityReport(
    @Args('input') input: CreateCommunityReportInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.reports.create(input, this.actor(ctx));
  }
  @UseGuards(GraphqlAdminGuard)
  @Query(() => CommunityReportsPage)
  adminCommunityReports(@Args('input') input: CommunityReportsInput) {
    return this.reports.list(input);
  }
  @UseGuards(GraphqlAdminGuard)
  @Mutation(() => CommunityReport)
  adminReviewCommunityReport(
    @Args('input') input: ReviewCommunityReportInput,
    @Context() ctx: PlatformGraphqlContext,
  ) {
    return this.reports.review(input, this.actor(ctx));
  }
}
