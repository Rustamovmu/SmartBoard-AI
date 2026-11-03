import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminPolicyModule } from '../admin/admin-policy.module';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import { HELP_MODEL, HelpEntrySchema } from './schemas/help-entry.schema';
import { HelpSchemaService } from './help-schema.service';
import { HelpService } from './help.service';
import { HelpResolver } from './help.resolver';
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AdminPolicyModule,
    MongooseModule.forFeature([{ name: HELP_MODEL, schema: HelpEntrySchema }]),
  ],
  providers: [HelpSchemaService, HelpService, HelpResolver, GraphqlAdminGuard],
  exports: [HelpSchemaService, HelpService],
})
export class HelpModule {}
