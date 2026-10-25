import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { HttpErrorResponse } from '../../contracts/platform-v1';

const ERRORS: Record<number, Omit<HttpErrorResponse, 'statusCode'>> = {
  400: { code: 'VALIDATION_ERROR', message: 'Invalid request.' },
  401: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
  403: { code: 'FORBIDDEN', message: 'Access denied.' },
  404: { code: 'NOT_FOUND', message: 'Route not found.' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
  409: { code: 'CONFLICT', message: 'Account could not be created.' },
  413: {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request exceeds the size limit.',
  },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests.' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' },
};

/** Never serialize request URLs, bodies, exception messages, or stack traces. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // GraphQL and WebSocket transports need their own error adapters later.
    if (host.getType() !== 'http') throw exception;

    const parserStatus =
      exception instanceof Error && 'type' in exception
        ? exception.type === 'entity.too.large'
          ? 413
          : exception.type === 'entity.parse.failed'
            ? 400
            : undefined
        : undefined;
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : (parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const error = ERRORS[statusCode] ?? {
      code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED',
      message:
        statusCode >= 500 ? 'Internal server error.' : 'Request rejected.',
    };

    if (statusCode >= 500) this.logger.error(`HTTP failure: ${statusCode}`);

    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.status(statusCode).json({ statusCode, ...error });
  }
}
