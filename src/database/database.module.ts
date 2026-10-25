import { Global, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppConfig } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';
import { DatabaseService } from './database.service';
import { openPlatformConnection } from './platform-connection';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: getConnectionToken(),
      inject: [AppConfig],
      // Custom factory keeps raw driver errors out of Nest retry/startup logs.
      // The standard token supports future MongooseModule.forFeature models.
      useFactory: (config: AppConfig) =>
        openPlatformConnection(config.database),
    },
    DatabaseService,
  ],
  exports: [getConnectionToken(), DatabaseService],
})
export class DatabaseModule {}
