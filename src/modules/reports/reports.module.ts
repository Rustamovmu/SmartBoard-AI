import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminPolicyModule } from '../admin/admin-policy.module';
import { CommunityModule } from '../community/community.module';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import { REPORT_MODEL, CommunityReportSchema } from './schemas/report.schema';
import { ReportSchemaService } from './report-schema.service';
import { ReportsService } from './reports.service';
import { ReportsResolver } from './reports.resolver';
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AdminPolicyModule,
    CommunityModule,
    MongooseModule.forFeature([
      { name: REPORT_MODEL, schema: CommunityReportSchema },
    ]),
  ],
  providers: [
    ReportSchemaService,
    ReportsService,
    ReportsResolver,
    GraphqlAdminGuard,
  ],
  exports: [ReportSchemaService],
})
export class ReportsModule {}
