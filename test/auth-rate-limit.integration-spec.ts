import { randomUUID } from 'node:crypto';
import type { Connection, Model } from 'mongoose';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';
import {
  AuthAttempt,
  AuthAttemptSchema,
} from '../src/modules/auth/schemas/auth-attempt.schema';
import {
  configureDisposableDatabase,
  assertInitiallyEmpty,
  assertExactTestDatabase,
  dropOwnedTestDatabase,
} from '../scripts/lib/disposable-database';

describe('concurrent rate budgets in an owned disposable database', () => {
  let connection: Connection,
    name: string,
    owned = false,
    attempts: Model<AuthAttempt>,
    limits: AuthRateLimitService;
  beforeAll(async () => {
    name = configureDisposableDatabase();
    connection = await openPlatformConnection(
      parseDatabaseEnvironment(process.env, 'test'),
    );
    await assertInitiallyEmpty(connection, name);
    owned = true;
    attempts = connection.model('RateConcurrencyFixture', AuthAttemptSchema);
    await attempts.createCollection();
    await attempts.createIndexes();
    limits = new AuthRateLimitService(attempts);
  });
  afterAll(async () => {
    try {
      if (owned) await dropOwnedTestDatabase(connection, name);
    } finally {
      await connection?.close();
    }
  });
  beforeEach(() => {
    assertExactTestDatabase(connection, name);
    // Isolate counter concurrency from epoch changes and server TTL cleanup.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
  });
  afterEach(() => jest.restoreAllMocks());
  it('accepts every concurrent first-bucket attempt when the whole burst fits the budget', async () => {
    for (let round = 0; round < 8; round++) {
      const identity = randomUUID();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          limits.consume('synthetic:burst', identity, 10),
        ),
      );
      expect(
        results.map((result) => ({
          status: result.status,
          code:
            result.status === 'rejected'
              ? (result.reason as { status?: number }).status
              : undefined,
        })),
      ).toEqual(Array(10).fill({ status: 'fulfilled', code: undefined }));
    }
  });
  it('preserves weighted costs while concurrent first-bucket attempts fit exactly', async () => {
    const identity = randomUUID();
    const results = await Promise.allSettled(
      [2, 2, 1].map((cost) =>
        limits.consume('synthetic:weighted', identity, 5, cost),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(
      Array(3).fill('fulfilled'),
    );
    await expect(
      limits.consume('synthetic:weighted', identity, 5),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('never exceeds a full bucket under concurrent rejection', async () => {
    const identity = randomUUID();
    await limits.consume('synthetic:full', identity, 5, 5);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        limits.consume('synthetic:full', identity, 5),
      ),
    );
    expect(
      results.every(
        (result) =>
          result.status === 'rejected' &&
          (result.reason as { status?: number }).status === 429,
      ),
    ).toBe(true);
  });
});
