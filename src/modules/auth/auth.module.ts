import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../database/database.module';
import { MembersModule } from '../members/members.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthConfig } from './auth.config';
import { AuthSessionService } from './auth-session.service';
import { AuthTransportService } from './auth-transport.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { AuthEntryGuard } from './guards/auth-entry.guard';
import { CurrentAccountGuard } from './guards/current-account.guard';
import { AdminGuard } from './guards/admin.guard';
import {
  AUTH_SESSION_MODEL,
  AuthSessionSchema,
} from './schemas/auth-session.schema';
import {
  AUTH_ATTEMPT_MODEL,
  AuthAttemptSchema,
} from './schemas/auth-attempt.schema';
import { AuthSchemaService } from './auth-schema.service';

@Module({
  imports: [
    DatabaseModule,
    MembersModule,
    MongooseModule.forFeature([
      { name: AUTH_SESSION_MODEL, schema: AuthSessionSchema },
      { name: AUTH_ATTEMPT_MODEL, schema: AuthAttemptSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthSchemaService,
    AuthConfig,
    AuthService,
    AuthSessionService,
    AuthTransportService,
    AuthRateLimitService,
    PasswordService,
    TokenService,
    AuthEntryGuard,
    CurrentAccountGuard,
    AdminGuard,
  ],
  exports: [
    AuthSessionService,
    AuthTransportService,
    AuthSchemaService,
    AuthConfig,
    PasswordService,
    CurrentAccountGuard,
    AdminGuard,
    MongooseModule,
    MembersModule,
  ],
})
export class AuthModule {}
