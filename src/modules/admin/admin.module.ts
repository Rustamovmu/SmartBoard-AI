import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminPolicyModule } from './admin-policy.module';
import { AdminService } from './admin.service';
import { AdminResolver } from './admin.resolver';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';

@Module({
  imports: [AuthModule, AuditModule, AdminPolicyModule],
  providers: [AdminService, AdminResolver, GraphqlAdminGuard],
})
export class AdminModule {}
