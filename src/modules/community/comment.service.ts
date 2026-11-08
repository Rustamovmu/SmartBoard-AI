import { isUUID } from 'class-validator';
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
import { CommunitySchemaService } from './community-schema.service';
import { CommentSchemaService } from './comment-schema.service';
import {
  COMMUNITY_MODEL,
  CommunityPostRecord,
} from './schemas/community-post.schema';
import {
  COMMENT_MODEL,
  CommunityCommentRecord,
} from './schemas/community-comment.schema';
import { CommunityState, CommunityModerationAction } from './dto/community.dto';
import type { CommunityActor } from './community.service';
import type {
  CommunityCommentsInput,
  ManagedCommunityCommentsInput,
  CreateCommunityCommentInput,
  UpdateCommunityCommentInput,
  ModerateCommunityCommentInput,
} from './dto/comment.dto';

@Injectable()
export class CommentService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(COMMENT_MODEL)
    private readonly comments: Model<CommunityCommentRecord>,
    @InjectModel(COMMUNITY_MODEL)
    private readonly posts: Model<CommunityPostRecord>,
    private readonly schema: CommentSchemaService,
    private readonly postSchema: CommunitySchemaService,
    private readonly policy: AdminPolicyService,
    private readonly auth: AuthSessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}
  private validate(value: { publicDisplayName: string; bodyMarkdown: string }) {
    if (
      !value.publicDisplayName.trim() ||
      value.publicDisplayName.trim().length > 80 ||
      !value.bodyMarkdown.trim() ||
      Buffer.byteLength(value.bodyMarkdown, 'utf8') > 4096
    )
      throw new BadRequestException();
    for (const char of value.publicDisplayName + value.bodyMarkdown) {
      const code = char.charCodeAt(0);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
        throw new BadRequestException();
    }
  }
  private publicView(comment: CommunityCommentRecord) {
    return {
      id: comment._id,
      postId: comment.postId,
      publicDisplayName: comment.publicDisplayName,
      bodyMarkdown: comment.bodyMarkdown,
      publishedAt: comment.publishedAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }
  private managed(comment: CommunityCommentRecord) {
    return {
      ...this.publicView(comment),
      authorUserId: comment.authorUserId,
      state: comment.state,
      revision: comment.revision,
      createdAt: comment.createdAt.toISOString(),
      removedAt: comment.removedAt?.toISOString() ?? null,
      removalReason: comment.removalReason,
    };
  }
  async published(input: CommunityCommentsInput) {
    await this.postSchema.assertPrepared();
    await this.schema.assertPrepared();
    // Parent visibility and comment projection belong to the same database operation.
    const [post] = await this.posts
      .aggregate<{
        comments: {
          items: CommunityCommentRecord[];
          totals: { total: number }[];
        }[];
      }>([
        { $match: { _id: input.postId, state: CommunityState.PUBLISHED } },
        {
          $lookup: {
            from: 'communityComments',
            pipeline: [
              {
                $match: {
                  postId: input.postId,
                  state: CommunityState.PUBLISHED,
                },
              },
              { $sort: { publishedAt: 1, _id: 1 } },
              {
                $facet: {
                  items: [
                    { $skip: (input.page - 1) * input.pageSize },
                    { $limit: input.pageSize },
                  ],
                  totals: [{ $count: 'total' }],
                },
              },
            ],
            as: 'comments',
          },
        },
      ])
      .exec();
    if (!post) throw new NotFoundException();
    const result = post.comments[0];
    return {
      items: (result?.items ?? []).map((c) => this.publicView(c)),
      page: input.page,
      pageSize: input.pageSize,
      total: result?.totals[0]?.total ?? 0,
    };
  }
  async get(id: string, ownerId?: string) {
    if (!isUUID(id, '4')) throw new BadRequestException();
    await this.schema.assertPrepared();
    const comment = await this.comments
      .findOne({ _id: id, ...(ownerId ? { authorUserId: ownerId } : {}) })
      .lean()
      .exec();
    if (!comment) throw new NotFoundException();
    return this.managed(comment);
  }
  async list(input: ManagedCommunityCommentsInput, ownerId?: string) {
    await this.schema.assertPrepared();
    const [result] = await this.comments
      .aggregate<{
        items: CommunityCommentRecord[];
        totals: { total: number }[];
      }>([
        {
          $match: {
            ...(ownerId ? { authorUserId: ownerId } : {}),
            ...(input.postId ? { postId: input.postId } : {}),
            ...(input.state ? { state: input.state } : {}),
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
      items: result.items.map((c) => this.managed(c)),
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
  private async parent(postId: string, session: ClientSession) {
    if (
      !(await this.posts
        .exists({ _id: postId, state: CommunityState.PUBLISHED })
        .session(session))
    )
      throw new NotFoundException();
  }
  private async ready(actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.postSchema.assertPrepared();
    await this.schema.assertPrepared();
  }
  async create(input: CreateCommunityCommentInput, actor: CommunityActor) {
    await this.ready(actor);
    this.validate(input);
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session);
      await this.parent(input.postId, session);
      const now = new Date();
      const [comment] = await this.comments.create(
        [
          {
            _id: randomUUID(),
            postId: input.postId,
            authorUserId: current._id,
            publicDisplayName: input.publicDisplayName.trim(),
            bodyMarkdown: input.bodyMarkdown,
            state: CommunityState.PUBLISHED,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            publishedAt: now,
            removedAt: null,
            removedByUserId: null,
            removalReason: null,
          },
        ],
        { session },
      );
      await this.audit.discussionChanged(
        'COMMENT',
        current,
        comment._id,
        'CREATE',
        null,
        comment.state,
        1,
        null,
        session,
      );
      return this.managed(comment.toObject());
    });
  }
  async update(input: UpdateCommunityCommentInput, actor: CommunityActor) {
    await this.ready(actor);
    const keys = ['publicDisplayName', 'bodyMarkdown', 'state'] as const;
    if (!keys.some((key) => input[key] !== undefined))
      throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session);
      const old = await this.comments
        .findOne({ _id: input.id, authorUserId: current._id })
        .session(session)
        .lean()
        .exec();
      if (!old) throw new NotFoundException();
      if (
        old.revision !== input.expectedRevision ||
        old.state === CommunityState.REMOVED ||
        input.state === CommunityState.REMOVED
      )
        throw new ConflictException();
      const next = Object.assign({}, old, {
        ...(input.publicDisplayName !== undefined
          ? { publicDisplayName: input.publicDisplayName.trim() }
          : {}),
        ...(input.bodyMarkdown !== undefined
          ? { bodyMarkdown: input.bodyMarkdown }
          : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
      });
      this.validate(next);
      // Withdrawal is allowed even when the parent is hidden; all other changes require a published parent.
      if (
        input.state !== CommunityState.DRAFT ||
        input.bodyMarkdown !== undefined ||
        input.publicDisplayName !== undefined
      )
        await this.parent(old.postId, session);
      if (keys.every((key) => old[key] === next[key])) return this.managed(old);
      next.revision++;
      next.updatedAt = new Date();
      if (
        old.state !== CommunityState.PUBLISHED &&
        next.state === CommunityState.PUBLISHED
      )
        next.publishedAt = next.updatedAt;
      await this.save(next, old.revision, session);
      await this.audit.discussionChanged(
        'COMMENT',
        current,
        next._id,
        'UPDATE',
        old.state,
        next.state,
        next.revision,
        null,
        session,
      );
      return this.managed(next);
    });
  }
  async moderate(input: ModerateCommunityCommentInput, actor: CommunityActor) {
    await this.ready(actor);
    const remove = input.action === CommunityModerationAction.REMOVE;
    if (remove ? input.reason === undefined : input.reason !== undefined)
      throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session, true);
      const old = await this.comments
        .findById(input.id)
        .session(session)
        .lean()
        .exec();
      if (!old) throw new NotFoundException();
      if (
        old.revision !== input.expectedRevision ||
        (remove
          ? old.state === CommunityState.REMOVED
          : old.state !== CommunityState.REMOVED)
      )
        throw new ConflictException();
      const now = new Date();
      const next = Object.assign({}, old, {
        state: remove ? CommunityState.REMOVED : CommunityState.DRAFT,
        revision: old.revision + 1,
        updatedAt: now,
        removedAt: remove ? now : null,
        removedByUserId: remove ? current._id : null,
        removalReason: remove ? input.reason! : null,
      });
      await this.save(next, old.revision, session);
      await this.audit.discussionChanged(
        'COMMENT',
        current,
        next._id,
        input.action,
        old.state,
        next.state,
        next.revision,
        input.reason ?? null,
        session,
      );
      return this.managed(next);
    });
  }
  private async save(
    comment: CommunityCommentRecord,
    revision: number,
    session: ClientSession,
  ) {
    const { _id, ...fields } = comment;
    const result = await this.comments.updateOne(
      { _id, revision },
      { $set: fields },
      { session, runValidators: true },
    );
    if (result.modifiedCount !== 1) throw new ConflictException();
  }
}
