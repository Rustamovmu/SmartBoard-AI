import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import {
  AUTH_POLICY,
  type AuthTransport,
  type PublicMember,
} from '../../contracts/auth-v1';
import { AuthConfig } from './auth.config';
import { TokenService } from './token.service';
import type { SessionGrant } from './auth-session.service';
import type { RefreshDto } from './dto/auth.dto';

export interface AuthRequest extends Request {
  authTransport: AuthTransport;
}

@Injectable()
export class AuthTransportService {
  constructor(
    private readonly config: AuthConfig,
    private readonly tokens: TokenService,
  ) {}

  readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.cookie;
    if (!header || header.length > 16_384) return undefined;
    const values = header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (values.length !== 1) return undefined;
    const value = values[0].slice(name.length + 1);
    return /^[A-Za-z0-9_.-]{1,512}$/.test(value) ? value : undefined;
  }

  assertRequest(request: Request): AuthTransport {
    const client = request.headers['x-smartbord-client'];
    if (client !== 'browser' && client !== 'native')
      throw new BadRequestException();
    if (request.method === 'POST' && !request.is('application/json'))
      throw new UnsupportedMediaTypeException();
    if (client === 'native') {
      if (request.headers.origin || request.headers.cookie)
        throw new ForbiddenException();
    } else {
      if (
        typeof request.headers.origin !== 'string' ||
        !this.config.browserOrigins.includes(request.headers.origin) ||
        request.headers.authorization
      )
        throw new ForbiddenException();
      if (request.method !== 'GET') {
        const cookie = this.readCookie(request, AUTH_POLICY.csrfCookie);
        const header = request.headers['x-csrf-token'];
        if (
          !cookie ||
          !/^[A-Za-z0-9_-]{43}$/.test(cookie) ||
          typeof header !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(header) ||
          header.length !== cookie.length ||
          !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
        )
          throw new ForbiddenException();
      }
    }
    return client;
  }

  issueCsrf(request: AuthRequest, response: Response) {
    if (request.authTransport !== 'browser') throw new BadRequestException();
    const csrfToken = this.tokens.secret();
    response.cookie(AUTH_POLICY.csrfCookie, csrfToken, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: AUTH_POLICY.sessionLifetimeMs,
    });
    return { csrfToken };
  }

  refreshCredential(
    request: AuthRequest,
    input: RefreshDto,
  ): string | undefined {
    if (request.authTransport === 'browser') {
      if (input.refreshToken !== undefined) throw new BadRequestException();
      return this.readCookie(request, AUTH_POLICY.refreshCookie);
    }
    return input.refreshToken;
  }

  accessCredential(request: AuthRequest): string | undefined {
    if (request.authTransport === 'browser')
      return this.readCookie(request, AUTH_POLICY.accessCookie);
    const header = request.headers.authorization;
    return typeof header === 'string' && /^Bearer [^\s]+$/.test(header)
      ? header.slice(7)
      : undefined;
  }

  respond(
    grant: SessionGrant,
    transport: AuthTransport,
    response: Response,
    user: PublicMember,
  ) {
    const common = {
      user,
      accessExpiresAt: grant.accessExpiresAt.toISOString(),
      sessionExpiresAt: grant.sessionExpiresAt.toISOString(),
    };
    if (transport === 'native')
      return {
        ...common,
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
      };
    for (const [name, value, expires] of [
      [AUTH_POLICY.accessCookie, grant.accessToken, grant.accessExpiresAt],
      [AUTH_POLICY.refreshCookie, grant.refreshToken, grant.sessionExpiresAt],
    ] as const) {
      response.cookie(name, value, {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        expires,
      });
    }
    return common;
  }

  clear(response: Response) {
    for (const name of [
      AUTH_POLICY.accessCookie,
      AUTH_POLICY.refreshCookie,
      AUTH_POLICY.csrfCookie,
    ]) {
      response.clearCookie(name, {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
    }
  }
}
