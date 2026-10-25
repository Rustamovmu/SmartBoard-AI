import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../database/database.module';
import { AuditService } from './audit.service';
import { AUDIT_MODEL, AuditEventSchema } from './schemas/audit-event.schema';

@Module({
  imports: [
    DatabaseModule,
    MongooseModule.forFeature([
      { name: AUDIT_MODEL, schema: AuditEventSchema },
    ]),
  ],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
