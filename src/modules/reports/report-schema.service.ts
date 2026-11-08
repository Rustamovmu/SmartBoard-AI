import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  REPORT_MODEL,
  REPORT_INDEXES,
  REPORT_UNIQUE_INDEX,
  CommunityReportRecord,
} from './schemas/report.schema';
@Injectable()
export class ReportSchemaService {
  constructor(
    @InjectModel(REPORT_MODEL)
    private readonly reports: Model<CommunityReportRecord>,
  ) {}
  async assertPrepared() {
    try {
      const actual = await this.reports.listIndexes();
      if (
        !REPORT_INDEXES.every((key) =>
          actual.some(
            (index) => JSON.stringify(index.key) === JSON.stringify(key),
          ),
        ) ||
        !actual.some(
          (index) =>
            index.unique === true &&
            index.sparse !== true &&
            index.partialFilterExpression === undefined &&
            JSON.stringify(index.key) === JSON.stringify(REPORT_UNIQUE_INDEX),
        )
      )
        throw new Error();
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async prepare() {
    await this.reports.createCollection();
    await this.reports.createIndexes();
    await this.assertPrepared();
  }
}
