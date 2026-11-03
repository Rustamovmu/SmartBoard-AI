import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  HELP_MODEL,
  HELP_INDEXES,
  HelpEntryRecord,
} from './schemas/help-entry.schema';
@Injectable()
export class HelpSchemaService {
  constructor(
    @InjectModel(HELP_MODEL) private readonly entries: Model<HelpEntryRecord>,
  ) {}
  async assertPrepared() {
    try {
      const actual = await this.entries.listIndexes();
      if (
        !HELP_INDEXES.every((expected) =>
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
