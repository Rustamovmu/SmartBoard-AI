import type { HttpAdapterHost } from '@nestjs/core';
import { AnalysisSocketService } from './analysis-socket.service';
import type { AnalysisConfig } from './analysis.config';
import type { AnalysisRegistryService } from './analysis-registry.service';

describe('analysis transport application context', () => {
  it('preserves operator CLI bootstrap and shutdown without an HTTP adapter', async () => {
    const service = new AnalysisSocketService(
      {} as HttpAdapterHost,
      { enabled: false } as AnalysisConfig,
      {} as AnalysisRegistryService,
    );
    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await service.onModuleDestroy();
  });
});
