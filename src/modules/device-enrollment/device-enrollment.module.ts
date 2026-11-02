import { Module } from '@nestjs/common';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import { AdminPolicyModule } from '../admin/admin-policy.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceRecordsModule } from './device-records.module';
import { DeviceEnrollmentResolver } from './device-enrollment.resolver';
import { DeviceEnrollmentService } from './device-enrollment.service';

@Module({
  imports: [AuthModule, AuditModule, AdminPolicyModule, DeviceRecordsModule],
  providers: [
    DeviceEnrollmentService,
    DeviceEnrollmentResolver,
    GraphqlAdminGuard,
  ],
})
export class DeviceEnrollmentModule {}
