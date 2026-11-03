import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { HelpSchemaService } from './help-schema.service';
import { HELP_MODEL, HelpEntryRecord } from './schemas/help-entry.schema';
import {
  HelpKind,
  HelpState,
  type HelpEntriesInput,
  type AdminHelpEntriesInput,
  type CreateHelpEntryInput,
  type UpdateHelpEntryInput,
} from './dto/help.dto';
@Injectable()
export class HelpService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HELP_MODEL) private readonly entries: Model<HelpEntryRecord>,
    private readonly schema: HelpSchemaService,
    private readonly policy: AdminPolicyService,
    private readonly auth: AuthSessionService,
    private readonly limits: AuthRateLimitService,
    private readonly audit: AuditService,
  ) {}
  private hasControls(text: string) {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
        return true;
    }
    return false;
  }
  private validate(record: {
    kind: HelpKind;
    title: string;
    bodyMarkdown: string;
    topic?: unknown;
  }) {
    if (
      !record.title.trim() ||
      record.title.trim().length > 160 ||
      !record.bodyMarkdown.trim() ||
      Buffer.byteLength(record.bodyMarkdown, 'utf8') > 16384 ||
      this.hasControls(record.title + record.bodyMarkdown)
    )
      throw new BadRequestException();
    if (record.kind === HelpKind.FAQ ? !record.topic : record.topic != null)
      throw new BadRequestException();
  }
  private id(id: string) {
    if (!isUUID(id, '4')) throw new BadRequestException();
  }
  private summary(entry: HelpEntryRecord) {
    return {
      id: entry._id,
      kind: entry.kind,
      title: entry.title,
      topic: entry.topic,
      order: entry.order,
      publishedAt: entry.publishedAt!.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }
  private managed(entry: HelpEntryRecord) {
    return {
      id: entry._id,
      kind: entry.kind,
      title: entry.title,
      bodyMarkdown: entry.bodyMarkdown,
      topic: entry.topic,
      order: entry.order,
      state: entry.state,
      revision: entry.revision,
      createdByUserId: entry.createdByUserId,
      updatedByUserId: entry.updatedByUserId,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      publishedAt: entry.publishedAt?.toISOString() ?? null,
    };
  }

  async list(input: HelpEntriesInput, admin = false) {
    await this.schema.assertPrepared();
    if (input.kind === HelpKind.ANNOUNCEMENT && input.topic !== undefined)
      throw new BadRequestException();
    const state = admin
      ? (input as AdminHelpEntriesInput).state
      : HelpState.PUBLISHED;
    const filter = {
      kind: input.kind,
      ...(state === undefined ? {} : { state }),
      ...(input.topic === undefined ? {} : { topic: input.topic }),
    };
    const sort: Record<string, 1 | -1> = admin
      ? { updatedAt: -1 as const, _id: 1 as const }
      : input.kind === HelpKind.FAQ
        ? { order: 1 as const, createdAt: 1 as const, _id: 1 as const }
        : { order: 1 as const, publishedAt: -1 as const, _id: 1 as const };
    // One aggregation keeps page metadata/items consistent for each response.
    const [result] = await this.entries
      .aggregate<{ items: HelpEntryRecord[]; totals: { total: number }[] }>([
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
      ])
      .exec();
    return {
      items: result.items.map((item) =>
        admin ? this.managed(item) : this.summary(item),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total: result.totals[0]?.total ?? 0,
    };
  }
  async get(id: string, admin = false) {
    this.id(id);
    await this.schema.assertPrepared();
    const entry = await this.entries
      .findOne({ _id: id, ...(admin ? {} : { state: HelpState.PUBLISHED }) })
      .lean()
      .exec();
    if (!entry) throw new NotFoundException();
    return admin
      ? this.managed(entry)
      : { ...this.summary(entry), bodyMarkdown: entry.bodyMarkdown };
  }
  private async actor(
    credential: string,
    transport: AuthTransport,
    session: ClientSession,
  ) {
    await this.policy.acquire(session);
    const current = await this.auth.authenticate(
      credential,
      transport,
      session,
    );
    if (current.user.role !== 'ADMIN') throw new ForbiddenException();
    return current.user._id;
  }
  async create(
    input: CreateHelpEntryInput,
    credential: string,
    transport: AuthTransport,
    actorId: string,
  ) {
    await this.schema.assertPrepared();
    this.validate(input);
    await this.limits.consume('help:write:account', actorId, 20);
    return this.connection.transaction(async (session) => {
      const actor = await this.actor(credential, transport, session);
      const now = new Date();
      const [entry] = await this.entries.create(
        [
          {
            _id: randomUUID(),
            kind: input.kind,
            title: input.title.trim(),
            bodyMarkdown: input.bodyMarkdown,
            topic: input.topic ?? null,
            order: input.order,
            state: HelpState.DRAFT,
            revision: 1,
            createdByUserId: actor,
            updatedByUserId: actor,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
          },
        ],
        { session },
      );
      await this.audit.helpChanged(
        actor,
        entry._id,
        null,
        entry.state,
        1,
        session,
      );
      return this.managed(entry.toObject());
    });
  }
  async update(
    input: UpdateHelpEntryInput,
    credential: string,
    transport: AuthTransport,
    actorId: string,
  ) {
    await this.schema.assertPrepared();
    this.id(input.id);
    const changed = [
      'title',
      'bodyMarkdown',
      'topic',
      'order',
      'state',
    ] as const;
    if (!changed.some((key) => input[key] !== undefined))
      throw new BadRequestException();
    await this.limits.consume('help:write:account', actorId, 20);
    return this.connection.transaction(async (session) => {
      const actor = await this.actor(credential, transport, session);
      const old = await this.entries
        .findById(input.id)
        .session(session)
        .lean()
        .exec();
      if (!old) throw new NotFoundException();
      if (old.revision !== input.expectedRevision)
        throw new ConflictException();
      if (
        old.state === HelpState.ARCHIVED &&
        (input.state !== HelpState.DRAFT ||
          changed.some((key) => key !== 'state' && input[key] !== undefined))
      )
        throw new BadRequestException();
      const next = Object.assign({}, old);
      if (input.title !== undefined) next.title = input.title.trim();
      if (input.bodyMarkdown !== undefined)
        next.bodyMarkdown = input.bodyMarkdown;
      if (input.topic !== undefined) next.topic = input.topic;
      if (input.order !== undefined) next.order = input.order;
      if (input.state !== undefined) next.state = input.state;
      this.validate(next);
      if (changed.every((key) => next[key] === old[key]))
        return this.managed(old);
      next.revision++;
      next.updatedByUserId = actor;
      next.updatedAt = new Date();
      if (
        next.state === HelpState.PUBLISHED &&
        old.state !== HelpState.PUBLISHED
      )
        next.publishedAt = next.updatedAt;
      const { _id, ...fields } = next;
      const result = await this.entries.updateOne(
        { _id, revision: input.expectedRevision },
        { $set: fields },
        { session, runValidators: true },
      );
      if (result.modifiedCount !== 1) throw new ConflictException();
      await this.audit.helpChanged(
        actor,
        _id,
        old.state,
        next.state,
        next.revision,
        session,
      );
      return this.managed(next);
    });
  }
}
