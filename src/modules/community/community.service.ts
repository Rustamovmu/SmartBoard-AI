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
import { isUUID } from 'class-validator';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { AdminPolicyService } from '../admin/admin-policy.service';
import { AuditService } from '../audit/audit.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { CommunitySchemaService } from './community-schema.service';
import {
  COMMUNITY_MODEL,
  CommunityPostRecord,
} from './schemas/community-post.schema';
import {
  CommunityState,
  CommunityModerationAction,
  type ManagedCommunityPostsInput,
  type CommunityPostsInput,
  type CreateCommunityPostInput,
  type UpdateCommunityPostInput,
  type ModerateCommunityPostInput,
} from './dto/community.dto';

export interface CommunityActor {
  credential: string;
  transport: AuthTransport;
  id: string;
}
@Injectable()
export class CommunityService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(COMMUNITY_MODEL)
    private readonly posts: Model<CommunityPostRecord>,
    private readonly schema: CommunitySchemaService,
    private readonly policy: AdminPolicyService,
    private readonly auth: AuthSessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}
  private validate(record: {
    title: string;
    publicDisplayName: string;
    bodyMarkdown: string;
  }) {
    if (
      !record.title.trim() ||
      record.title.trim().length > 160 ||
      !record.publicDisplayName.trim() ||
      record.publicDisplayName.trim().length > 80 ||
      !record.bodyMarkdown.trim() ||
      Buffer.byteLength(record.bodyMarkdown, 'utf8') > 16384
    )
      throw new BadRequestException();
    for (const char of record.title +
      record.publicDisplayName +
      record.bodyMarkdown) {
      const code = char.charCodeAt(0);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
        throw new BadRequestException();
    }
  }
  private id(id: string) {
    if (!isUUID(id, '4')) throw new BadRequestException();
  }
  private summary(post: CommunityPostRecord) {
    return {
      id: post._id,
      title: post.title,
      publicDisplayName: post.publicDisplayName,
      publishedAt: post.publishedAt!.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }
  private managed(post: CommunityPostRecord) {
    return {
      id: post._id,
      authorUserId: post.authorUserId,
      title: post.title,
      publicDisplayName: post.publicDisplayName,
      bodyMarkdown: post.bodyMarkdown,
      state: post.state,
      revision: post.revision,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      publishedAt: post.publishedAt?.toISOString() ?? null,
      removedAt: post.removedAt?.toISOString() ?? null,
      removalReason: post.removalReason,
    };
  }
  // These scopes are constructed only by resolvers after authentication/guards.
  async list(
    input: CommunityPostsInput | ManagedCommunityPostsInput,
    scope: 'public' | 'owner' | 'admin',
    ownerId?: string,
  ) {
    if (scope === 'owner' && !ownerId) throw new UnauthorizedException();
    await this.schema.assertPrepared();
    const state =
      scope === 'public'
        ? CommunityState.PUBLISHED
        : (input as ManagedCommunityPostsInput).state;
    const filter = {
      ...(state === undefined ? {} : { state }),
      ...(scope === 'owner' ? { authorUserId: ownerId } : {}),
    };
    const sort: Record<string, 1 | -1> =
      scope === 'public'
        ? { publishedAt: -1, _id: 1 }
        : { updatedAt: -1, _id: 1 };
    const [result] = await this.posts
      .aggregate<{ items: CommunityPostRecord[]; totals: { total: number }[] }>(
        [
          { $match: filter },
          { $sort: sort },
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
      )
      .exec();
    return {
      items: result.items.map((post) =>
        scope === 'public' ? this.summary(post) : this.managed(post),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total: result.totals[0]?.total ?? 0,
    };
  }
  async get(id: string, scope: 'public' | 'owner' | 'admin', ownerId?: string) {
    if (scope === 'owner' && !ownerId) throw new UnauthorizedException();
    this.id(id);
    await this.schema.assertPrepared();
    const post = await this.posts
      .findOne({
        _id: id,
        ...(scope === 'public' ? { state: CommunityState.PUBLISHED } : {}),
        ...(scope === 'owner' ? { authorUserId: ownerId } : {}),
      })
      .lean()
      .exec();
    if (!post) throw new NotFoundException();
    return scope === 'public'
      ? { ...this.summary(post), bodyMarkdown: post.bodyMarkdown }
      : this.managed(post);
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
  async create(input: CreateCommunityPostInput, actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.schema.assertPrepared();
    this.validate(input);
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session);
      const now = new Date();
      const [post] = await this.posts.create(
        [
          {
            _id: randomUUID(),
            authorUserId: current._id,
            title: input.title.trim(),
            publicDisplayName: input.publicDisplayName.trim(),
            bodyMarkdown: input.bodyMarkdown,
            state: CommunityState.DRAFT,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
            removedAt: null,
            removedByUserId: null,
            removalReason: null,
          },
        ],
        { session },
      );
      await this.audit.communityChanged(
        current._id,
        current.role,
        post._id,
        'CREATE',
        null,
        post.state,
        1,
        null,
        session,
      );
      return this.managed(post.toObject());
    });
  }
  async update(input: UpdateCommunityPostInput, actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.schema.assertPrepared();
    this.id(input.id);
    const keys = [
      'title',
      'publicDisplayName',
      'bodyMarkdown',
      'state',
    ] as const;
    if (!keys.some((key) => input[key] !== undefined))
      throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session);
      const old = await this.posts
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
      const next = Object.assign({}, old);
      if (input.title !== undefined) next.title = input.title.trim();
      if (input.publicDisplayName !== undefined)
        next.publicDisplayName = input.publicDisplayName.trim();
      if (input.bodyMarkdown !== undefined)
        next.bodyMarkdown = input.bodyMarkdown;
      if (input.state !== undefined) next.state = input.state;
      this.validate(next);
      if (keys.every((key) => next[key] === old[key])) return this.managed(old);
      next.revision++;
      next.updatedAt = new Date();
      if (
        next.state === CommunityState.PUBLISHED &&
        old.state !== CommunityState.PUBLISHED
      )
        next.publishedAt = next.updatedAt;
      await this.save(next, input.expectedRevision, session);
      await this.audit.communityChanged(
        current._id,
        current.role,
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
  async moderate(input: ModerateCommunityPostInput, actor: CommunityActor) {
    await this.limits.consume('community:write:account', actor.id, 20);
    await this.schema.assertPrepared();
    this.id(input.id);
    const remove = input.action === CommunityModerationAction.REMOVE;
    if (remove ? input.reason === undefined : input.reason !== undefined)
      throw new BadRequestException();
    return this.connection.transaction(async (session) => {
      const current = await this.actor(actor, session, true);
      const old = await this.posts
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
      await this.save(next, input.expectedRevision, session);
      await this.audit.communityChanged(
        current._id,
        current.role,
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
    post: CommunityPostRecord,
    revision: number,
    session: ClientSession,
  ) {
    const { _id, ...fields } = post;
    const result = await this.posts.updateOne(
      { _id, revision },
      { $set: fields },
      { session, runValidators: true },
    );
    if (result.modifiedCount !== 1) throw new ConflictException();
  }
}
