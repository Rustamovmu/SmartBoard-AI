import type { Connection } from 'mongoose';
import { DatabaseService } from './database.service';

describe('database shutdown', () => {
  it('closes only the injected app-owned connection', async () => {
    const connection = { close: jest.fn().mockResolvedValue(undefined) };
    const service = new DatabaseService(connection as unknown as Connection);
    await service.onApplicationShutdown();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it('does not propagate raw driver errors during shutdown', async () => {
    const connection = {
      close: jest.fn().mockRejectedValue(new Error('synthetic-secret-uri')),
    };
    const service = new DatabaseService(connection as unknown as Connection);
    await expect(service.onApplicationShutdown()).rejects.toThrow(
      'Platform database connection could not close cleanly.',
    );
  });
});
