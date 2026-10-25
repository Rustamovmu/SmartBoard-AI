import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  getLiveness() {
    return { status: 'ok' as const };
  }

  async getReadiness() {
    const checks = await this.database.checkHealth();
    return {
      status:
        checks.platformDatabase === 'up' && checks.transactions === 'supported'
          ? ('ready' as const)
          : ('not_ready' as const),
      checks,
    };
  }
}
