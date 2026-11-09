import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  AuthTransportService,
  type AuthRequest,
} from '../auth/auth-transport.service';
import { AuthSchemaService } from '../auth/auth-schema.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { DeviceSchemaService } from '../device-enrollment/device-schema.service';
import { strictJson } from '../../contracts/analysis-media-v2';
import { AnalysisMediaService } from './analysis-media.service';
import { VisionUnavailableException } from './analysis.errors';
import { AnalysisConfig } from './analysis.config';
import { AnalysisRegistryService } from './analysis-registry.service';

@Injectable()
export class AnalysisAccessService {
  constructor(
    private readonly config: AnalysisConfig,
    private readonly transport: AuthTransportService,
    private readonly sessions: AuthSessionService,
    private readonly schema: AuthSchemaService,
    private readonly devices: DeviceSchemaService,
    private readonly limits: AuthRateLimitService,
    private readonly registry: AnalysisRegistryService,
    private readonly media: AnalysisMediaService,
  ) {}

  async issue(request: AuthRequest, body: unknown) {
    if (!this.config.enabled) throw new ServiceUnavailableException();
    request.authTransport = this.transport.assertRequest(request);
    if (request.authTransport !== 'native') throw new ForbiddenException();
    let exactBody: unknown;
    try {
      if (!request.rawBody) throw new Error();
      exactBody = strictJson(request.rawBody);
    } catch {
      throw new BadRequestException();
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !exactBody ||
      typeof exactBody !== 'object' ||
      Array.isArray(exactBody) ||
      !(
        Object.keys(exactBody).length === 0 ||
        (Object.keys(exactBody).length === 1 &&
          (exactBody as { protocolVersion?: unknown }).protocolVersion === 2)
      ) ||
      request.originalUrl !== '/analysis/access'
    )
      throw new BadRequestException();
    const version = Object.keys(exactBody).length === 0 ? 1 : 2;
    await Promise.all([
      this.schema.assertPrepared(),
      this.devices.assertPrepared(),
    ]);
    await this.limits.consume('analysis:grant:ip', request.ip ?? 'unknown', 30);
    const raw = this.transport.accessCredential(request);
    if (!raw) throw new UnauthorizedException();
    const account = await this.sessions.authenticate(raw, 'native');
    await this.limits.consume('analysis:grant:account', account.user._id, 10);
    if (!account.deviceId) throw new ForbiddenException();
    if (version === 2 && (!this.config.mediaEnabled || !this.media.available))
      throw new VisionUnavailableException();
    const binding = {
      sessionId: account.sessionId,
      userId: account.user._id,
      deviceId: account.deviceId,
      accountVersion: account.user.authVersion,
      expiresAt: Math.min(
        account.accessExpiresAt.getTime(),
        account.sessionExpiresAt.getTime(),
      ),
    };
    await this.registry.validate(binding);
    return this.registry.reserve(binding, version);
  }
}
