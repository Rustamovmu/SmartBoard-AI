import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { isEmail } from 'class-validator';
import { AppModule } from '../src/app.module';
import { MembersService } from '../src/modules/members/members.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuditService } from '../src/modules/audit/audit.service';

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (
    !email ||
    !isEmail(email) ||
    email.length > 254 ||
    !name ||
    name.length > 80 ||
    !password ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new Error('Explicit valid administrator details are required.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.get(AuthSchemaService).assertPrepared();
    const passwordHash = await app.get(PasswordService).hash(password);
    await app
      .get<Connection>(getConnectionToken())
      .transaction(async (session) => {
        const user = await app
          .get(MembersService)
          .create({ email, name, passwordHash }, 'ADMIN', session);
        await app
          .get(AuditService)
          .administratorBootstrapped(user._id, session);
      });
    console.log(
      'Administrator created. No existing account was promoted or modified.',
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    'Administrator creation failed. Supply explicit bootstrap settings, prepare indexes, and use an unused email.',
  );
  process.exitCode = 1;
});
