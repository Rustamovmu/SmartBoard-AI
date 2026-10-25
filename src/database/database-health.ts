import type { Connection } from 'mongoose';

export interface DatabaseHealth {
  platformDatabase: 'up' | 'down';
  transactions: 'supported' | 'unsupported' | 'unknown';
}

/** Read-only probe. Topology support does not prove CRUD/transaction permissions. */
export async function checkDatabaseHealth(
  connection: Connection,
): Promise<DatabaseHealth> {
  if (connection.readyState !== 1 || !connection.db) {
    return { platformDatabase: 'down', transactions: 'unknown' };
  }
  try {
    await connection.db.command({ ping: 1 }, { timeoutMS: 2_000 });
    const hello = await connection.db
      .admin()
      .command({ hello: 1 }, { timeoutMS: 2_000 });
    const replicaSet = typeof hello.setName === 'string';
    const sharded = hello.msg === 'isdbgrid';
    const sessions = typeof hello.logicalSessionTimeoutMinutes === 'number';
    const wireVersion =
      typeof hello.maxWireVersion === 'number' ? hello.maxWireVersion : 0;
    const supported =
      sessions &&
      ((replicaSet && wireVersion >= 7) || (sharded && wireVersion >= 8));
    return {
      platformDatabase: 'up',
      transactions: supported ? 'supported' : 'unsupported',
    };
  } catch {
    return { platformDatabase: 'down', transactions: 'unknown' };
  }
}
