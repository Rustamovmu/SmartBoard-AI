import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  COMMENT_MODEL,
  COMMENT_INDEXES,
  CommunityCommentRecord,
} from './schemas/community-comment.schema';
@Injectable()
export class CommentSchemaService {
  constructor(
    @InjectModel(COMMENT_MODEL)
    private readonly comments: Model<CommunityCommentRecord>,
  ) {}
  async assertPrepared() {
    try {
      const indexes = await this.comments.listIndexes();
      if (
        !COMMENT_INDEXES.every((key) =>
          indexes.some(
            (index) => JSON.stringify(index.key) === JSON.stringify(key),
          ),
        )
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async prepare() {
    await this.comments.createCollection();
    await this.comments.createIndexes();
    await this.assertPrepared();
  }
}
