import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import { AdminPolicyService } from '../admin/admin-policy.service';
import { AuditService } from '../audit/audit.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { CommunitySchemaService } from '../community/community-schema.service';
import { CommentSchemaService } from '../community/comment-schema.service';
import {
  COMMUNITY_MODEL,
  CommunityPostRecord,
} from '../community/schemas/community-post.schema';
import {
  COMMENT_MODEL,
  CommunityCommentRecord,
} from '../community/schemas/community-comment.schema';
import { CommunityState } from '../community/dto/community.dto';
import type { CommunityActor } from '../community/community.service';
import { ReportSchemaService } from './report-schema.service';
import { REPORT_MODEL, CommunityReportRecord } from './schemas/report.schema';
import {
  ReportState,
  ReportTarget,
  type CreateCommunityReportInput,
  type CommunityReportsInput,
  type ReviewCommunityReportInput,
} from './dto/report.dto';
@Injectable()
export class ReportsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(REPORT_MODEL)
    private readonly reports: Model<CommunityReportRecord>,
    @InjectModel(COMMUNITY_MODEL)
    private readonly posts: Model<CommunityPostRecord>,
    @InjectModel(COMMENT_MODEL)
    private readonly comments: Model<CommunityCommentRecord>,
    private readonly schema: ReportSchemaService,
    private readonly postSchema: CommunitySchemaService,
    private readonly commentSchema: CommentSchemaService,
    private readonly policy: AdminPolicyService,
    private readonly auth: AuthSessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}
  private view(report: CommunityReportRecord) {
    return {
      id: report._id,
      targetType: report.targetType,
      targetId: report.targetId,
      postId: report.postId,
      reason: report.reason,
      state: report.state,
      revision: report.revision,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
  async list(input: CommunityReportsInput, ownerId?: string) {
    await this.schema.assertPrepared();
    const [result] = await this.reports
      .aggregate<{
        items: CommunityReportRecord[];
        totals: { total: number }[];
      }>([
        {
          $match: {
            ...(ownerId ? { reporterUserId: ownerId } : {}),
            ...(input.state ? { state: input.state } : {}),
            ...(input.targetType ? { targetType: input.targetType } : {}),
          },
        },
        { $sort: { updatedAt: -1, _id: 1 } },
        {
          $facet: {
            items: [
              { $skip: (input.page - 1) * input.pageSize },
              { $limit: input.pageSize },
            ],
            totals: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    return {
      items: result.items.map((r) => this.view(r)),
      page: input.page,
      pageSize: input.pageSize,
      total: result.totals[0]?.total ?? 0,
    };
  }
  private async actor(
    actor: CommunityActor,
    session: ClientSession,
    admin = false,
  ) {
    await this.policy.acquire(session);
    const current = await this.auth.authenticate(
      actor.credential,
      actor.transport,
      session,
    );
    if (current.user._id !== actor.id) throw new UnauthorizedException();
    if (admin && current.user.role !== 'ADMIN') throw new ForbiddenException();
    return current.user;
  }
  async create(input: CreateCommunityReportInput, actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.limits.consume('community:report:account', actor.id, 10);
    await this.schema.assertPrepared();
    await this.postSchema.assertPrepared();
    if (input.targetType === ReportTarget.COMMENT)
      await this.commentSchema.assertPrepared();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session);
      let postId = input.targetId;
      if (input.targetType === ReportTarget.COMMENT) {
        const comment = await this.comments
          .findOne({ _id: input.targetId, state: CommunityState.PUBLISHED })
          .session(session)
          .lean()
          .exec();
        if (!comment) throw new NotFoundException();
        postId = comment.postId;
      }
      if (
        !(await this.posts
          .exists({ _id: postId, state: CommunityState.PUBLISHED })
          .session(session))
      )
        throw new NotFoundException();
      if (
        await this.reports
          .exists({
            reporterUserId: current._id,
            targetType: input.targetType,
            targetId: input.targetId,
          })
          .session(session)
      )
        throw new ConflictException();
      const now = new Date();
      const [report] = await this.reports.create(
        [
          {
            _id: randomUUID(),
            reporterUserId: current._id,
            targetType: input.targetType,
            targetId: input.targetId,
            postId,
            reason: input.reason,
            state: ReportState.OPEN,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            reviewedByUserId: null,
          },
        ],
        { session },
      );
      await this.audit.discussionChanged(
        'REPORT',
        current,
        report._id,
        'CREATE',
        null,
        report.state,
        1,
        input.reason,
        session,
      );
      return this.view(report.toObject());
    });
  }
  async review(input: ReviewCommunityReportInput, actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.schema.assertPrepared();
    if (input.state === ReportState.OPEN) throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session, true);
      const old = await this.reports
        .findById(input.id)
        .session(session)
        .lean()
        .exec();
      if (!old) throw new NotFoundException();
      if (
        old.revision !== input.expectedRevision ||
        old.state !== ReportState.OPEN
      )
        throw new ConflictException();
      const next = Object.assign({}, old, {
        state: input.state,
        revision: old.revision + 1,
        updatedAt: new Date(),
        reviewedByUserId: current._id,
      });
      const { _id, ...fields } = next;
      const result = await this.reports.updateOne(
        { _id, revision: old.revision },
        { $set: fields },
        { session, runValidators: true },
      );
      if (result.modifiedCount !== 1) throw new ConflictException();
      await this.audit.discussionChanged(
        'REPORT',
        current,
        _id,
        'REVIEW',
        old.state,
        next.state,
        next.revision,
        null,
        session,
      );
      return this.view(next);
    });
  }
}
