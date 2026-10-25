import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuthSchemaService } from '../auth/auth-schema.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authSchema: AuthSchemaService,
  ) {}

  getLiveness() {
    return { status: 'ok' as const };
  }

  async getReadiness() {
    const checks = await this.database.checkHealth();
    let authentication: 'ready' | 'not_ready' = 'not_ready';
    if (checks.platformDatabase === 'up') {
      try {
        await this.authSchema.assertPrepared();
        authentication = 'ready';
      } catch {
        /* readiness only; no raw driver errors */
      }
    }
    return {
      status:
        checks.platformDatabase === 'up' &&
        checks.transactions === 'supported' &&
        authentication === 'ready'
          ? ('ready' as const)
          : ('not_ready' as const),
      checks: { ...checks, authentication },
    };
  }
}
