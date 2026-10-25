import 'reflect-metadata';
import { parseEnvironment } from '../src/config/environment';
import { parseDatabaseEnvironment } from '../src/config/database-environment';
import { openPlatformConnection } from '../src/database/platform-connection';
import { checkDatabaseHealth } from '../src/database/database-health';
import { PLATFORM_COLLECTIONS } from '../src/contracts/platform-v1';

async function main() {
  const environment = parseEnvironment(process.env);
  const settings = parseDatabaseEnvironment(process.env, environment.nodeEnv);
  const connection = await openPlatformConnection(settings);
  try {
    const health = await checkDatabaseHealth(connection);
    const collections = await connection
      .db!.listCollections({}, { nameOnly: true })
      .toArray();
    const unexpected = collections.filter(
      ({ name }) => !(PLATFORM_COLLECTIONS as readonly string[]).includes(name),
    );
    let unexpectedNonemptyCollectionCount = 0;
    for (const { name } of unexpected) {
      const count = await connection.db!.collection(name).countDocuments(
        {},
        {
          limit: 1,
          maxTimeMS: 2_000,
        },
      );
      if (count > 0) unexpectedNonemptyCollectionCount += 1;
    }
    // Report only non-content state. Do not print URI, host, users or collection names.
    console.log(
      JSON.stringify({
        database: settings.name,
        ...health,
        collectionCount: collections.length,
        unexpectedCollectionCount: unexpected.length,
        unexpectedNonemptyCollectionCount,
      }),
    );
    if (
      health.platformDatabase !== 'up' ||
      health.transactions !== 'supported' ||
      unexpected.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await connection.close();
  }
}

void main().catch(() => {
  console.error(
    'Database check failed. Verify the ignored .env connection settings, database access, and network allowlist. No raw connection error is logged.',
  );
  process.exitCode = 1;
});
