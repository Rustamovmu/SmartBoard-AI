import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminPolicyModule } from '../admin/admin-policy.module';
import { UsernameResolver } from './username.resolver';
import { UsernameService } from './username.service';
@Module({
  imports: [AuthModule, AuditModule, AdminPolicyModule],
  providers: [UsernameService, UsernameResolver],
})
export class UsernameModule {}
