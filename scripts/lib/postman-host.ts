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
import {
  assertInitiallyEmpty,
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
    const testRunId = name.slice('sbt_'.length);
    app.use((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('X-SmartBord-Test-Run', testRunId);
      next();
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { baseUrl: await app.getUrl(), database: name, testRunId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
