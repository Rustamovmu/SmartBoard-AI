export interface DatabaseSettings {
  uri: string;
  name: string;
}

const TEST_DATABASE_PATTERN = /^smartbord_test_[a-f0-9]{32}$/;

/** Tests must explicitly opt into an exact disposable name; never use app data. */
export function assertDisposableDatabase(name: string): void {
  if (!TEST_DATABASE_PATTERN.test(name)) {
    throw new Error(
      'Test database must be named smartbord_test_<32 hex digits>.',
    );
  }
}

export function parseDatabaseEnvironment(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
): DatabaseSettings {
  if (env.JEST_WORKER_ID && nodeEnv !== 'test') {
    throw new Error('Database tests require NODE_ENV=test.');
  }
  const isTest = nodeEnv === 'test';
  const uri = isTest
    ? env.MONGODB_TEST_URI?.trim()
    : env.MONGODB_URI?.trim() ||
      (nodeEnv === 'development' ? env.MONGO_DEV?.trim() : undefined);
  const name = isTest ? env.MONGODB_TEST_DATABASE : 'SmartBoardAI';

  if (!uri) {
    throw new Error(
      isTest
        ? 'MONGODB_TEST_URI is required for database integration tests.'
        : 'MONGODB_URI is required (MONGO_DEV is also supported in development).',
    );
  }
  if (!name) throw new Error('MONGODB_TEST_DATABASE is required for tests.');
  if (isTest) assertDisposableDatabase(name);

  if (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(uri)) {
    throw new Error('Database connection must use a MongoDB URI.');
  }

  // A mismatched URI must fail rather than silently selecting another project.
  const authorityStart = uri.indexOf('://') + 3;
  const pathStart = uri.indexOf('/', authorityStart);
  if (pathStart !== -1) {
    let uriDatabase: string;
    try {
      uriDatabase = decodeURIComponent(uri.slice(pathStart + 1).split('?')[0]);
    } catch {
      throw new Error('Database URI contains an invalid database name.');
    }
    if (uriDatabase && uriDatabase !== name) {
      throw new Error(
        'Database URI must select the configured application database.',
      );
    }
  }

  return { uri, name };
}
