import {
  assertDisposableDatabase,
  parseDatabaseEnvironment,
} from './database-environment';

const testName = 'smartbord_test_0123456789abcdef0123456789abcdef';

describe('database configuration safety', () => {
  it('supports the existing development MONGO_DEV key', () => {
    expect(
      parseDatabaseEnvironment(
        { MONGO_DEV: 'mongodb://127.0.0.1/SmartBoardAI' },
        'development',
      ),
    ).toEqual({
      uri: 'mongodb://127.0.0.1/SmartBoardAI',
      name: 'SmartBoardAI',
    });
  });

  it('prefers MONGODB_URI and accepts a URI without a database path', () => {
    expect(
      parseDatabaseEnvironment(
        { MONGODB_URI: 'mongodb://127.0.0.1', MONGO_DEV: 'unused' },
        'development',
      ).name,
    ).toBe('SmartBoardAI');
  });

  it('requires MONGODB_URI in production', () => {
    expect(() =>
      parseDatabaseEnvironment(
        { MONGO_DEV: 'mongodb://127.0.0.1' },
        'production',
      ),
    ).toThrow('MONGODB_URI is required');
  });

  it('never falls back to application credentials in tests', () => {
    expect(() =>
      parseDatabaseEnvironment(
        { MONGODB_URI: 'mongodb://127.0.0.1/SmartBoardAI' },
        'test',
      ),
    ).toThrow('MONGODB_TEST_URI is required');
  });

  it('refuses an application connection from a Jest worker outside test mode', () => {
    expect(() =>
      parseDatabaseEnvironment(
        { JEST_WORKER_ID: '1', MONGODB_URI: 'mongodb://127.0.0.1/SmartBoardAI' },
        'production',
      ),
    ).toThrow('Database tests require NODE_ENV=test.');
  });

  it('requires a separate matching disposable database in tests', () => {
    expect(
      parseDatabaseEnvironment(
        {
          MONGODB_TEST_URI: `mongodb://127.0.0.1/${testName}`,
          MONGODB_TEST_DATABASE: testName,
        },
        'test',
      ).name,
    ).toBe(testName);
  });

  it.each([
    'SmartBoardAI',
    'admin',
    'smartbord_test_',
    '',
    `${testName}_other`,
  ])('rejects unsafe disposable database name %p', (name) =>
    expect(() => assertDisposableDatabase(name)).toThrow(),
  );

  it.each([
    'https://example.invalid/SmartBoardAI',
    'mongodb://user:synthetic-secret@example.invalid/another-project',
    'mongodb://example.invalid/SmartBoardAI%ZZ',
  ])('rejects an invalid/mismatched URI without exposing its value', (uri) => {
    try {
      parseDatabaseEnvironment({ MONGODB_URI: uri }, 'development');
      throw new Error('Expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(uri);
      expect((error as Error).message).not.toContain('synthetic-secret');
      expect((error as Error).message).not.toBe(
        'Expected configuration rejection',
      );
    }
  });

  it('rejects a test URI pointing at the application database', () => {
    expect(() =>
      parseDatabaseEnvironment(
        {
          MONGODB_TEST_URI: 'mongodb://127.0.0.1/SmartBoardAI',
          MONGODB_TEST_DATABASE: testName,
        },
        'test',
      ),
    ).toThrow('configured application database');
  });
});
