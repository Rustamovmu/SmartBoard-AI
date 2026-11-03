import { json } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthConfig } from './modules/auth/auth.config';
import type { Request, Response, NextFunction } from 'express';

/** Used by the actual host and HTTP/integration tests. No body/payload logging. */
export function configureApplication(app: NestExpressApplication) {
  app.use('/graphql', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return next();
    if (req.method !== 'POST')
      return res.status(405).json({
        statusCode: 405,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed.',
      });
    if (!req.is('application/json'))
      return res.status(415).json({
        statusCode: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Unsupported content type.',
      });
    next();
  });
  app.use('/graphql', json({ limit: '64kb', strict: true }));
  app.use('/graphql', (req: Request, res: Response, next: NextFunction) => {
    if (
      typeof req.body?.query === 'string' &&
      Buffer.byteLength(req.body.query, 'utf8') > 8192
    )
      return res
        .status(413)
        .json({
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request too large.',
        });
    next();
  });
  app.useBodyParser('json', { limit: '8kb', strict: true });
  const origins = app.get(AuthConfig).browserOrigins;
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-SmartBord-Client',
      'X-CSRF-Token',
    ],
  });
}
