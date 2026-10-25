import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FORBIDDEN_HTTP_PATHS } from '../src/contracts/platform-v1';
import { getConnectionToken } from '@nestjs/mongoose';
import { createConnectionStub } from './helpers/connection-stub';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const connection = createConnectionStub();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getConnectionToken())
      .useValue(connection)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('reports process liveness without claiming platform readiness', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect('Cache-Control', 'no-store')
      .expect(200, { status: 'ok' });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect('Cache-Control', 'no-store')
      .expect(503, {
        status: 'not_ready',
        checks: { platformDatabase: 'down', transactions: 'unknown' },
      });
  });

  it('reports readiness only when the database and transaction topology are available', async () => {
    connection.readyState = 1;
    try {
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect('Cache-Control', 'no-store')
        .expect(200, {
          status: 'ready',
          checks: { platformDatabase: 'up', transactions: 'supported' },
        });
      connection.hello.mockResolvedValueOnce({ maxWireVersion: 17 });
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503, {
          status: 'not_ready',
          checks: { platformDatabase: 'up', transactions: 'unsupported' },
        });
    } finally {
      connection.readyState = 0;
    }
  });

  it.each(FORBIDDEN_HTTP_PATHS)(
    'does not expose private-content endpoint %s',
    async (path) => {
      for (const method of ['get', 'post', 'delete'] as const) {
        await request(app.getHttpServer())
          [method](path)
          .expect('Cache-Control', 'no-store')
          .expect(404, {
            statusCode: 404,
            code: 'NOT_FOUND',
            message: 'Route not found.',
          });
      }
    },
  );

  it('does not echo paths, queries, or bodies into errors', async () => {
    await request(app.getHttpServer())
      .post('/lectures/synthetic-private-title?token=synthetic-secret')
      .send({ note: 'synthetic-private-note' })
      .expect(404, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Route not found.',
      });
  });

  afterAll(async () => {
    await app.close();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
