import type { Connection } from 'mongoose';
import { dropOwnedTestDatabase } from './disposable-database';

describe('destructive test cleanup boundary', () => {
  const expected = 'sbt_0123456789abcdef0123456789abcdef';
  const previousName = process.env.MONGODB_TEST_DATABASE;
  const previousMode = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_TEST_DATABASE = expected;
  });
  afterEach(() => {
    if (previousName === undefined) delete process.env.MONGODB_TEST_DATABASE;
    else process.env.MONGODB_TEST_DATABASE = previousName;
    process.env.NODE_ENV = previousMode;
  });
  it('drops only a connection matching the exact generated name in test mode', async () => {
    const connection = {
      name: expected,
      db: { databaseName: expected },
      dropDatabase: jest.fn().mockResolvedValue(undefined),
    };
    await dropOwnedTestDatabase(connection as unknown as Connection, expected);
    expect(connection.dropDatabase).toHaveBeenCalledTimes(1);
  });
  it.each([
    'SmartBoardAI',
    'production',
    'sbt_abcdef0123456789abcdef0123456789',
  ])('refuses a different database %s', async (actual) => {
    const connection = {
      name: actual,
      db: { databaseName: actual },
      dropDatabase: jest.fn(),
    };
    await expect(
      dropOwnedTestDatabase(connection as unknown as Connection, expected),
    ).rejects.toThrow();
    expect(connection.dropDatabase).not.toHaveBeenCalled();
  });
  it('refuses production even for a matching name', async () => {
    process.env.NODE_ENV = 'production';
    const connection = {
      name: expected,
      db: { databaseName: expected },
      dropDatabase: jest.fn(),
    };
    await expect(
      dropOwnedTestDatabase(connection as unknown as Connection, expected),
    ).rejects.toThrow();
    expect(connection.dropDatabase).not.toHaveBeenCalled();
  });
});
