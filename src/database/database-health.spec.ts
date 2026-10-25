import type { Connection } from 'mongoose';
import { checkDatabaseHealth } from './database-health';

describe('database readiness', () => {
  const ping = jest.fn();
  const hello = jest.fn();
  const connection = {
    readyState: 1,
    db: { command: ping, admin: () => ({ command: hello }) },
  };
  const check = () => checkDatabaseHealth(connection as unknown as Connection);

  beforeEach(() => {
    connection.readyState = 1;
    ping.mockReset().mockResolvedValue({ ok: 1 });
    hello.mockReset().mockResolvedValue({
      setName: 'synthetic-replica',
      logicalSessionTimeoutMinutes: 30,
      maxWireVersion: 17,
    });
  });

  it('requires a connected database and issues bounded read-only probes', async () => {
    expect(await check()).toEqual({
      platformDatabase: 'up',
      transactions: 'supported',
    });
    expect(ping).toHaveBeenCalledWith({ ping: 1 }, { timeoutMS: 2_000 });
    expect(hello).toHaveBeenCalledWith({ hello: 1 }, { timeoutMS: 2_000 });
  });

  it('does not contact a disconnected database', async () => {
    connection.readyState = 0;
    expect(await check()).toEqual({
      platformDatabase: 'down',
      transactions: 'unknown',
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it('does not treat a standalone server as transaction-capable', async () => {
    hello.mockResolvedValue({
      logicalSessionTimeoutMinutes: 30,
      maxWireVersion: 17,
    });
    expect(await check()).toEqual({
      platformDatabase: 'up',
      transactions: 'unsupported',
    });
  });

  it('supports a session-capable sharded topology', async () => {
    hello.mockResolvedValue({
      msg: 'isdbgrid',
      logicalSessionTimeoutMinutes: 30,
      maxWireVersion: 17,
    });
    expect(await check()).toEqual({
      platformDatabase: 'up',
      transactions: 'supported',
    });
  });

  it('does not claim support without sessions or sufficient wire version', async () => {
    hello.mockResolvedValueOnce({
      setName: 'synthetic-replica',
      maxWireVersion: 17,
    });
    expect((await check()).transactions).toBe('unsupported');
    hello.mockResolvedValueOnce({
      setName: 'synthetic-replica',
      logicalSessionTimeoutMinutes: 30,
      maxWireVersion: 6,
    });
    expect((await check()).transactions).toBe('unsupported');
  });

  it('returns safe failed state when a driver error contains credentials', async () => {
    ping.mockRejectedValue(new Error('synthetic-secret-uri-and-frame'));
    expect(await check()).toEqual({
      platformDatabase: 'down',
      transactions: 'unknown',
    });
    expect(hello).not.toHaveBeenCalled();
  });
});
