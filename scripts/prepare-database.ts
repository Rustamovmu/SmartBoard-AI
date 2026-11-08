import { CommentSchemaService } from '../src/modules/community/comment-schema.service';
import { ReportSchemaService } from '../src/modules/reports/report-schema.service';
import { CommunitySchemaService } from '../src/modules/community/community-schema.service';
import { HelpSchemaService } from '../src/modules/help-center/help-schema.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { DeviceSchemaService } from '../src/modules/device-enrollment/device-schema.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(DeviceSchemaService).prepare();
    await app.get(HelpSchemaService).prepare();
    await app.get(CommunitySchemaService).prepare();
    await app.get(CommentSchemaService).prepare();
    await app.get(ReportSchemaService).prepare();
    console.log(
      'Platform collections, indexes and administrator policy are prepared. No accounts were created or indexes dropped.',
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    'Platform schema setup failed. Check database configuration, permissions, and existing indexes.',
  );
  process.exitCode = 1;
});
