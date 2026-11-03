import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AdminPolicyModule } from '../admin/admin-policy.module';
import { GraphqlAdminGuard } from '../../graphql/graphql-admin.guard';
import {
  COMMUNITY_MODEL,
  CommunityPostSchema,
} from './schemas/community-post.schema';
import { CommunitySchemaService } from './community-schema.service';
import { CommunityService } from './community.service';
import { CommunityResolver } from './community.resolver';
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AdminPolicyModule,
    MongooseModule.forFeature([
      { name: COMMUNITY_MODEL, schema: CommunityPostSchema },
    ]),
  ],
  providers: [
    CommunitySchemaService,
    CommunityService,
    CommunityResolver,
    GraphqlAdminGuard,
  ],
  exports: [CommunitySchemaService, CommunityService],
})
export class CommunityModule {}
