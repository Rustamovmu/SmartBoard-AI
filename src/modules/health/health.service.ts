import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getLiveness() {
    return { status: 'ok' as const };
  }

  getReadiness() {
    // Fail closed until B2 supplies a real platform-database readiness check.
    return {
      status: 'not_ready' as const,
      checks: { platformDatabase: 'not_implemented' as const },
    };
  }
}
