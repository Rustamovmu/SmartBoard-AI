import { UsernameModule } from './modules/members/username.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { CommunityModule } from './modules/community/community.module';
import { HelpModule } from './modules/help-center/help.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { PlatformGraphqlModule } from './graphql/platform-graphql.module';
import { DeviceEnrollmentModule } from './modules/device-enrollment/device-enrollment.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    AuditModule,
    AdminModule,
    DeviceEnrollmentModule,
    PlatformGraphqlModule,
    HelpModule,
    CommunityModule,
    ReportsModule,
    UsernameModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
          forbidUnknownValues: true,
          validationError: { target: false, value: false },
          exceptionFactory: () => new BadRequestException(),
        }),
    },
  ],
})
export class AppModule {}
