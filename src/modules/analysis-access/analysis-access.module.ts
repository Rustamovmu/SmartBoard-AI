import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceRecordsModule } from '../device-enrollment/device-records.module';
import { AnalysisAccessController } from './analysis-access.controller';
import { AnalysisAccessService } from './analysis-access.service';
import { AnalysisConfig } from './analysis.config';
import { AnalysisIdentityService } from './analysis-identity.service';
import { AnalysisRegistryService } from './analysis-registry.service';
import { AnalysisMediaService } from './analysis-media.service';
import { AnalysisCandidateService } from './analysis-decision-v3';
import { AnalysisSocketService } from './analysis-socket.service';

@Module({
  imports: [AuthModule, DeviceRecordsModule],
  controllers: [AnalysisAccessController],
  providers: [
    AnalysisConfig,
    AnalysisMediaService,
    AnalysisCandidateService,
    AnalysisAccessService,
    AnalysisIdentityService,
    AnalysisRegistryService,
    AnalysisSocketService,
  ],
})
export class AnalysisAccessModule {}
