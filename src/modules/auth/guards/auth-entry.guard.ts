import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  AuthTransportService,
  type AuthRequest,
} from '../auth-transport.service';
import { AuthRateLimitService } from '../auth-rate-limit.service';
import { AuthSchemaService } from '../auth-schema.service';

@Injectable()
export class AuthEntryGuard implements CanActivate {
  constructor(
    private readonly transport: AuthTransportService,
    private readonly limits: AuthRateLimitService,
    private readonly schema: AuthSchemaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    request.authTransport = this.transport.assertRequest(request);
    await this.schema.assertPrepared();
    const scope = context.getHandler().name;
    await this.limits.consume(
      `auth:${scope}:ip`,
      request.ip ?? 'unknown',
      scope === 'signup' ? 10 : scope === 'login' ? 20 : 60,
    );
    return true;
  }
}
