import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  COMMUNITY_MODEL,
  COMMUNITY_INDEXES,
  CommunityPostRecord,
} from './schemas/community-post.schema';
@Injectable()
export class CommunitySchemaService {
  constructor(
    @InjectModel(COMMUNITY_MODEL)
    private readonly entries: Model<CommunityPostRecord>,
  ) {}
  async assertPrepared() {
    try {
      const actual = await this.entries.listIndexes();
      if (
        !COMMUNITY_INDEXES.every((expected) =>
          actual.some(
            (index) => JSON.stringify(index.key) === JSON.stringify(expected),
          ),
        )
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async prepare() {
    await this.entries.createCollection();
    await this.entries.createIndexes();
    await this.assertPrepared();
  }
}
