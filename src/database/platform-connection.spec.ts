import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { openPlatformConnection } from './platform-connection';

describe('database connection lifecycle', () => {
  const connection = {
    on: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    openUri: jest.fn(),
    close: jest.fn(),
  };
  const settings = {
    uri: 'mongodb://user:synthetic-secret@example.invalid/SmartBoardAI',
    name: 'SmartBoardAI',
  };

  beforeEach(() => {
    connection.openUri.mockReset().mockResolvedValue(connection);
    connection.close.mockReset().mockResolvedValue(undefined);
    jest
      .spyOn(mongoose, 'createConnection')
      .mockReturnValue(connection as unknown as Connection);
  });

  afterEach(() => jest.restoreAllMocks());

  it('disables automatic writes, buffering and command monitoring', async () => {
    expect(await openPlatformConnection(settings)).toBe(connection);
    expect(connection.set).toHaveBeenCalledWith('debug', false);
    expect(connection.openUri).toHaveBeenCalledWith(
      settings.uri,
      expect.objectContaining({
        dbName: 'SmartBoardAI',
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
        monitorCommands: false,
        serverSelectionTimeoutMS: 5_000,
      }),
    );
  });

  it('closes a failed connection and exposes only a fixed safe error', async () => {
    connection.openUri.mockRejectedValue(
      new Error(`synthetic-error: ${settings.uri}`),
    );
    await expect(openPlatformConnection(settings)).rejects.toThrow(
      'Platform database connection failed; check local connection settings and network access.',
    );
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
