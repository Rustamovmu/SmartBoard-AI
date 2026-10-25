import { createConnection } from 'mongoose';
import type { Connection } from 'mongoose';
import type { DatabaseSettings } from '../config/database-environment';

/** Owns one connection. No schema registration or database writes occur here. */
export async function openPlatformConnection(
  settings: DatabaseSettings,
): Promise<Connection> {
  const connection = createConnection();
  // The driver may emit errors containing hostnames or credentials. Do not log them.
  connection.on('error', () => undefined);
  connection.set('debug', false);
  try {
    await connection.openUri(settings.uri, {
      dbName: settings.name,
      autoCreate: false,
      autoIndex: false,
      bufferCommands: false,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      socketTimeoutMS: 5_000,
      maxPoolSize: 10,
      minPoolSize: 0,
      monitorCommands: false,
    });
    return connection;
  } catch {
    await connection.close().catch(() => undefined);
    // Never attach the raw driver error as a cause or include the connection URI.
    throw new Error(
      'Platform database connection failed; check local connection settings and network access.',
    );
  }
}
