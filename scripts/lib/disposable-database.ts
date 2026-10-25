import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import {
  assertDisposableDatabase,
  parseDatabaseEnvironment,
} from '../../src/config/database-environment';

export function configureDisposableDatabase() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Disposable tests refuse production mode.');
  const local = existsSync('.env')
    ? parseEnv(readFileSync('.env', 'utf8'))
    : {};
  const uri = process.env.MONGODB_TEST_URI ?? local.MONGODB_TEST_URI;
  const name = `sbt_${randomUUID().replaceAll('-', '')}`;
  const settings = parseDatabaseEnvironment(
    { MONGODB_TEST_URI: uri, MONGODB_TEST_DATABASE: name },
    'test',
  );
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_TEST_URI = settings.uri;
  process.env.MONGODB_TEST_DATABASE = name;
  return name;
}

export function assertExactTestDatabase(
  connection: Connection,
  expected: string,
) {
  assertDisposableDatabase(expected);
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.MONGODB_TEST_DATABASE !== expected ||
    connection.name !== expected ||
    connection.db?.databaseName !== expected
  ) {
    throw new Error(
      'Refusing cleanup outside the exact owned disposable database.',
    );
  }
}

export async function assertInitiallyEmpty(
  connection: Connection,
  expected: string,
) {
  assertExactTestDatabase(connection, expected);
  const collections = await connection
    .db!.listCollections({}, { nameOnly: true })
    .toArray();
  if (collections.length !== 0)
    throw new Error(
      'Refusing to reuse a database containing existing collections.',
    );
}

export async function dropOwnedTestDatabase(
  connection: Connection,
  expected: string,
) {
  assertExactTestDatabase(connection, expected);
  await connection.dropDatabase();
}
