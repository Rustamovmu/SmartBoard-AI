import { CommentSchemaService } from '../src/modules/community/comment-schema.service';
import { ReportSchemaService } from '../src/modules/reports/report-schema.service';
import { CommunitySchemaService } from '../src/modules/community/community-schema.service';
import { HelpSchemaService } from '../src/modules/help-center/help-schema.service';
// Test-only IPC host. Never imported by AppModule or exposed as an HTTP route.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AdminPolicyService } from '../src/modules/admin/admin-policy.service';
import { DeviceSchemaService } from '../src/modules/device-enrollment/device-schema.service';
import { MembersService } from '../src/modules/members/members.service';
import { PasswordService } from '../src/modules/auth/password.service';
import {
  assertExactTestDatabase,
  assertInitiallyEmpty,
  configureDisposableDatabase,
  dropOwnedTestDatabase,
} from './lib/disposable-database';

async function main() {
  if (!process.env.BROWSER_TEST_CERT || !process.env.BROWSER_TEST_KEY)
    throw new Error('Explicit test TLS certificate and key required.');
  const name = configureDisposableDatabase();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
    httpsOptions:
      process.env.BROWSER_TEST_HTTP === '1'
        ? undefined
        : {
            cert: readFileSync(process.env.BROWSER_TEST_CERT),
            key: readFileSync(process.env.BROWSER_TEST_KEY),
          },
  });
  const connection = app.get<Connection>(getConnectionToken());
  let owned = false;
  let closing: Promise<void> | undefined;
  let timeout: NodeJS.Timeout | undefined;
  const close = () =>
    (closing ??= (async () => {
      clearTimeout(timeout);
      try {
        // Stop serving before dropping the exact owned fixture database.
        const server = app.getHttpServer() as import('node:https').Server;
        if (server.listening) {
          server.closeIdleConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
        if (owned) await dropOwnedTestDatabase(connection, name);
      } finally {
        await app.close();
      }
      if (process.connected) process.send?.({ kind: 'closed', removed: owned });
    })());
  const finish = () => {
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', finish);
  process.once('SIGINT', finish);
  process.once('disconnect', finish);
  try {
    await assertInitiallyEmpty(connection, name);
    owned = true;
    await app.get(AuthSchemaService).prepare();
    await app.get(AuditService).prepare();
    await app.get(AdminPolicyService).prepare();
    await app.get(DeviceSchemaService).prepare();
    await app.get(HelpSchemaService).prepare();
    await app.get(CommunitySchemaService).prepare();
    await app.get(CommentSchemaService).prepare();
    await app.get(ReportSchemaService).prepare();
    // Explicit browser-admin mode only. Seed through services after proving
    // ownership/initial emptiness; never accept caller-selected fixture details.
    const adminFixture: { id: string; email: string; name: string }[] = [];
    if (process.env.BROWSER_TEST_ADMIN === '1') {
      assertExactTestDatabase(connection, name);
      const marker = name.slice('sbt_'.length);
      const passwordHash = await app
        .get(PasswordService)
        .hash(`Synthetic-admin-${marker}`);
      await connection.transaction(async (session) => {
        adminFixture.length = 0;
        await app.get(AdminPolicyService).acquire(session);
        for (let index = 0; index < 26; index++) {
          const role = index < 2 ? 'ADMIN' : 'USER';
          const user = await app.get(MembersService).create(
            {
              email: `admin-web-${marker}-${index}@example.test`,
              name:
                index < 2
                  ? `Synthetic Administrator ${index + 1}`
                  : `Synthetic Member ${String(index).padStart(2, '0')}`,
              passwordHash,
            },
            role,
            session,
          );
          if (role === 'ADMIN')
            await app
              .get(AuditService)
              .administratorBootstrapped(user._id, session);
          adminFixture.push({
            id: user._id,
            email: user.email,
            name: user.name,
          });
        }
      });
    }
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    if (process.connected)
      process.send?.({
        kind: 'ready',
        origin:
          process.env.BROWSER_TEST_HTTP === '1'
            ? `http://127.0.0.1:${port}`
            : `https://localhost:${port}`,
        database: name,
        ...(adminFixture.length ? { adminFixture } : {}),
      });
    timeout = setTimeout(
      finish,
      (process.env.BROWSER_TEST_DISCUSSION === '1' ? 30 : 15) * 60_000,
    );
    // A private parent-process channel can expire/block synthetic fixtures or
    // temporarily remove/restore one fixed community index for outage checks.
    // It accepts opaque IDs only, checks the exact DB each time, and cannot
    // issue credentials, select another DB or operate on application records.
    process.on(
      'message',
      (message: { kind?: string; id?: string; userId?: string }) => {
        void (async () => {
          if (message.kind === 'close') {
            finish();
            return;
          }
          assertExactTestDatabase(connection, name);
          if (!/^[a-f0-9-]{36}$/.test(message.userId || ''))
            throw new Error('Invalid fixture ID.');
          if (message.kind === 'expire-access') {
            await connection
              .collection('authSessions')
              .updateMany(
                { userId: message.userId },
                { $set: { accessExpiresAt: new Date(0) } },
              );
          } else if (message.kind === 'block') {
            await connection
              .collection('users')
              .updateOne({ _id: message.userId } as never, {
                $set: { status: 'BLOCKED' },
              });
          } else if (
            message.kind === 'community-index-unavailable' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await connection
              .collection('communityPosts')
              .dropIndex('state_1_publishedAt_-1__id_1');
          } else if (
            message.kind === 'community-index-prepare' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await app.get(CommunitySchemaService).prepare();
          } else if (
            message.kind === 'comment-index-unavailable' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await connection
              .collection('communityComments')
              .dropIndex('postId_1_state_1_publishedAt_1__id_1');
          } else if (
            message.kind === 'comment-index-prepare' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await app.get(CommentSchemaService).prepare();
          } else if (
            message.kind === 'report-index-unavailable' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await connection
              .collection('reports')
              .dropIndex('reporterUserId_1_targetType_1_targetId_1');
          } else if (
            message.kind === 'report-index-prepare' &&
            process.env.BROWSER_TEST_ADMIN === '1'
          ) {
            await app.get(ReportSchemaService).prepare();
          } else throw new Error('Unknown fixture command.');
          if (process.connected)
            process.send?.({ kind: 'done', id: message.id });
        })().catch(() => {
          if (process.connected)
            process.send?.({ kind: 'failed', id: message.id });
        });
      },
    );
    // stdin EOF is another parent-death signal for manually launched hosts.
    createInterface({ input: process.stdin }).once('close', finish);
  } catch {
    await close();
    throw new Error('Browser fixture setup failed.');
  }
}

void main().catch(() => {
  console.error(
    'Browser test host failed; no credentials or database details emitted.',
  );
  process.exitCode = 1;
});
