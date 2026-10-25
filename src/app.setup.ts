import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthConfig } from './modules/auth/auth.config';

/** Used by the actual host and HTTP/integration tests. No body/payload logging. */
export function configureApplication(app: NestExpressApplication) {
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
