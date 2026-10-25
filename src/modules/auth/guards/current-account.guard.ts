import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthSessionService } from '../auth-session.service';
import {
  AuthTransportService,
  type AuthRequest,
} from '../auth-transport.service';
import type { Member } from '../../members/schemas/member.schema';

export interface CurrentAccountRequest extends AuthRequest {
  account: { user: Member; sessionId: string };
}

@Injectable()
export class CurrentAccountGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly transport: AuthTransportService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CurrentAccountRequest>();
    // Also usable outside the /auth controller; never trust a decoded token alone.
    request.authTransport = this.transport.assertRequest(request);
    const raw = this.transport.accessCredential(request);
    if (!raw) throw new UnauthorizedException();
    request.account = await this.sessions.authenticate(
      raw,
      request.authTransport,
    );
    return true;
  }
}
