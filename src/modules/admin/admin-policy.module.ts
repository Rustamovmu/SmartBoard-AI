import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../database/database.module';
import { AdminPolicyService } from './admin-policy.service';
import {
  ADMIN_POLICY_MODEL,
  AdminPolicySchema,
} from './schemas/admin-policy.schema';

@Module({
  imports: [
    DatabaseModule,
    MongooseModule.forFeature([
      { name: ADMIN_POLICY_MODEL, schema: AdminPolicySchema },
    ]),
  ],
  providers: [AdminPolicyService],
  exports: [AdminPolicyService],
})
export class AdminPolicyModule {}
