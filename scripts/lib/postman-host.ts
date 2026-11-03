import { HelpSchemaService } from '../../src/modules/help-center/help-schema.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import type { Server } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/app.setup';
import { AuthSchemaService } from '../../src/modules/auth/auth-schema.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AdminPolicyService } from '../../src/modules/admin/admin-policy.service';
import { DeviceSchemaService } from '../../src/modules/device-enrollment/device-schema.service';
import { MembersService } from '../../src/modules/members/members.service';
import { PasswordService } from '../../src/modules/auth/password.service';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service';
import {
  assertInitiallyEmpty,
  assertExactTestDatabase,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from './disposable-database';

export async function createPostmanTestHost() {
  const name = configureDisposableDatabase();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  const connection = app.get<Connection>(getConnectionToken());
  let owned = false;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        const server: Server = app.getHttpServer();
        if (server.listening) {
          await new Promise<void>((resolve, reject) =>
            server.close((error) =>
              error
                ? reject(new Error('Postman listener shutdown failed.'))
                : resolve(),
            ),
          );
        }
        if (owned) await dropOwnedTestDatabase(connection, name);
      } finally {
        await app.close();
      }
      console.log(
        owned
          ? 'Postman test host stopped; its exact disposable database was removed.'
          : 'Postman host closed without removing a database.',
      );
    })());
  try {
    await assertInitiallyEmpty(connection, name);
    owned = true;
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(DeviceSchemaService).prepare();
    await app.get(HelpSchemaService).prepare();
    const testRunId = name.slice('sbt_'.length);
    // Synthetic fixture only, after proving this exact disposable DB was empty.
    // Collection scripts derive these credentials in runtime variables; no real admin.
    const passwordHash = await app
      .get(PasswordService)
      .hash(`synthetic-test-${testRunId}`);
    await connection.transaction(async (session) => {
      await app.get(AdminPolicyService).acquire(session);
      const admin = await app.get(MembersService).create(
        {
          email: `admin-${testRunId}@example.test`,
          name: 'Synthetic Postman Administrator',
          passwordHash,
        },
        'ADMIN',
        session,
      );
      await app.get(AuditService).administratorBootstrapped(admin._id, session);
    });
    app.use((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('X-SmartBord-Test-Run', testRunId);
      next();
    });
    // One-shot synthetic fixture delivery, only in this guarded disposable host.
    // Not registered in AppModule or any production controller. No caller can
    // select an account; prior collection requests run before this fixture exists.
    let recoveryFixtureUsed = false;
    app.use('/__test/recovery-proof', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      if (
        req.method !== 'GET' ||
        req.headers['x-smartbord-test-run'] !== testRunId ||
        recoveryFixtureUsed
      ) {
        res.status(404).json({ code: 'NOT_FOUND' });
        return;
      }
      recoveryFixtureUsed = true;
      void (async () => {
        assertExactTestDatabase(connection, name);
        const email = `recovery-${testRunId}@example.test`;
        const member = await connection.transaction(async (session) => {
          await app.get(AdminPolicyService).acquire(session);
          return app
            .get(MembersService)
            .create(
              { email, name: 'Synthetic Postman Recovery Owner', passwordHash },
              'USER',
              session,
            );
        });
        const proof = await app.get(PasswordRecoveryService).issue(email);
        res.json({ ...proof, email, userId: member._id });
      })().catch(() => {
        res.status(503).json({ code: 'FIXTURE_UNAVAILABLE' });
      });
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { baseUrl: await app.getUrl(), database: name, testRunId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
