import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuditService } from '../src/modules/audit/audit.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    console.log(
      'Platform authentication collections and indexes are prepared. No records were created or indexes dropped.',
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    'Platform schema setup failed. Check database configuration, permissions, and existing indexes.',
  );
  process.exitCode = 1;
});
