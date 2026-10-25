import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { checkDatabaseHealth } from './database-health';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  checkHealth() {
    return checkDatabaseHealth(this.connection);
  }

  async onApplicationShutdown() {
    try {
      await this.connection.close();
    } catch {
      throw new Error('Platform database connection could not close cleanly.');
    }
  }
}
