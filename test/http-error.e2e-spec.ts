import {
  BadRequestException,
  Controller,
  ConflictException,
  Get,
  HttpException,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { getConnectionToken } from '@nestjs/mongoose';
import { createConnectionStub } from './helpers/connection-stub';
import { AuthSchemaService } from '../src/modules/auth/auth-schema.service';
import { UsernameTakenException } from '../src/modules/members/username-taken.exception';

// Only registered in this test app, never in the production module.
@Controller('synthetic-error')
class SyntheticErrorController {
  @Get('username-taken')
  usernameTaken() {
    throw new UsernameTakenException();
  }

  @Get('spoofed-username-taken')
  spoofedUsernameTaken() {
    throw new ConflictException({
      code: 'USERNAME_TAKEN',
      message: 'synthetic-private-note',
    });
  }

  @Get('validation')
  validation() {
    throw new BadRequestException({ message: 'synthetic-private-note' });
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('synthetic-credential-and-frame-payload');
  }

  @Get('unavailable')
  unavailable() {
    throw new HttpException('synthetic-internal-service-address', 503);
  }
}

describe('safe HTTP errors (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SyntheticErrorController],
    })
      .overrideProvider(getConnectionToken())
      .useValue(createConnectionStub())
      .overrideProvider(AuthSchemaService)
      .useValue({ assertPrepared: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['validation', 400, 'VALIDATION_ERROR', 'Invalid request.'],
    ['unexpected', 500, 'INTERNAL_ERROR', 'Internal server error.'],
    ['unavailable', 503, 'SERVICE_UNAVAILABLE', 'Service unavailable.'],
    [
      'username-taken',
      409,
      'USERNAME_TAKEN',
      'This username is already in use. Please choose a different username.',
    ],
    [
      'spoofed-username-taken',
      409,
      'CONFLICT',
      'Account could not be created.',
    ],
  ] as const)(
    'returns a stable safe response for %s',
    async (path, statusCode, code, message) => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      try {
        await request(app.getHttpServer())
          .get(`/synthetic-error/${path}`)
          .expect('Cache-Control', 'no-store')
          .expect(statusCode, { statusCode, code, message });
        expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-');
        if (statusCode >= 500) {
          expect(log).toHaveBeenCalledWith(`HTTP failure: ${statusCode}`);
        } else {
          expect(log).not.toHaveBeenCalled();
        }
      } finally {
        log.mockRestore();
      }
    },
  );
});
