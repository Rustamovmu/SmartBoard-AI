import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AnalysisConfig, parseAnalysisEnabled } from './analysis.config';
import { AnalysisRegistryService } from './analysis-registry.service';
import {
  AnalysisIdentityService,
  type AnalysisBinding,
} from './analysis-identity.service';
import { AnalysisBusyException } from './analysis.errors';

describe('bounded analysis registry', () => {
  let registry: AnalysisRegistryService;
  let validate: jest.Mock;
  const binding = (userId: string = randomUUID()): AnalysisBinding => ({
    userId,
    sessionId: randomUUID(),
    deviceId: randomUUID(),
    accountVersion: 0,
    expiresAt: Date.now() + 900_000,
  });
  beforeEach(() => {
    jest.useFakeTimers();
    validate = jest.fn().mockResolvedValue(undefined);
    registry = new AnalysisRegistryService(
      { enabled: true } as AnalysisConfig,
      { validate } as unknown as AnalysisIdentityService,
    );
    registry.onModuleInit();
  });
  afterEach(async () => {
    registry.onModuleDestroy();
    await Promise.resolve();
    jest.useRealTimers();
  });

  it('validates a default-off strict boolean without echoing input', () => {
    expect(parseAnalysisEnabled({})).toBe(false);
    expect(parseAnalysisEnabled({ ANALYSIS_TRANSPORT_ENABLED: 'true' })).toBe(
      true,
    );
    for (const value of ['', '1', 'TRUE', 'false ', 'synthetic-secret'])
      expect(() =>
        parseAnalysisEnabled({ ANALYSIS_TRANSPORT_ENABLED: value }),
      ).toThrow('ANALYSIS_TRANSPORT_ENABLED must be true or false.');
  });

  it('validates the separate media opt-in and absolute Python override', () => {
    const previous = {
      transport: process.env.ANALYSIS_TRANSPORT_ENABLED,
      media: process.env.ANALYSIS_MEDIA_ENABLED,
      python: process.env.VISION_PYTHON_EXECUTABLE,
    };
    try {
      delete process.env.ANALYSIS_TRANSPORT_ENABLED;
      delete process.env.ANALYSIS_MEDIA_ENABLED;
      delete process.env.VISION_PYTHON_EXECUTABLE;
      expect(new AnalysisConfig()).toMatchObject({
        enabled: false,
        mediaEnabled: false,
      });
      process.env.ANALYSIS_TRANSPORT_ENABLED = 'true';
      process.env.ANALYSIS_MEDIA_ENABLED = 'true';
      expect(new AnalysisConfig().mediaEnabled).toBe(true);
      process.env.ANALYSIS_TRANSPORT_ENABLED = 'false';
      expect(() => new AnalysisConfig()).toThrow(
        'Analysis media requires the transport flag.',
      );
      process.env.ANALYSIS_TRANSPORT_ENABLED = 'true';
      process.env.ANALYSIS_MEDIA_ENABLED = '1';
      expect(() => new AnalysisConfig()).toThrow(
        'ANALYSIS_MEDIA_ENABLED must be true or false.',
      );
      process.env.ANALYSIS_MEDIA_ENABLED = 'false';
      process.env.VISION_PYTHON_EXECUTABLE = 'python';
      expect(() => new AnalysisConfig()).toThrow(
        'VISION_PYTHON_EXECUTABLE must be an absolute path.',
      );
    } finally {
      if (previous.transport === undefined)
        delete process.env.ANALYSIS_TRANSPORT_ENABLED;
      else process.env.ANALYSIS_TRANSPORT_ENABLED = previous.transport;
      if (previous.media === undefined)
        delete process.env.ANALYSIS_MEDIA_ENABLED;
      else process.env.ANALYSIS_MEDIA_ENABLED = previous.media;
      if (previous.python === undefined)
        delete process.env.VISION_PYTHON_EXECUTABLE;
      else process.env.VISION_PYTHON_EXECUTABLE = previous.python;
    }
  });

  it('keeps only ticket hashes and enforces endpoint scope and atomic redemption', async () => {
    const grant = registry.reserve(binding());
    expect(
      JSON.stringify([
        ...(
          registry as unknown as { tickets: Map<string, unknown> }
        ).tickets.keys(),
      ]),
    ).not.toContain(grant.analyzeTicket);
    await expect(
      registry.redeem(grant.analyzeTicket, 'control'),
    ).rejects.toThrow(UnauthorizedException);
    const attempts = await Promise.allSettled([
      registry.redeem(grant.analyzeTicket, 'analyze'),
      registry.redeem(grant.analyzeTicket, 'analyze'),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const stream = await registry.redeem(grant.controlTicket, 'control');
    expect(stream.id).toBe(grant.streamId);
  });

  it('enforces device, account and global capacity atomically and releases expired grants', async () => {
    const first = binding();
    registry.reserve(first);
    expect(() => registry.reserve(first)).toThrow(AnalysisBusyException);
    registry.reserve(binding(first.userId));
    expect(() => registry.reserve(binding(first.userId))).toThrow(
      AnalysisBusyException,
    );
    for (let i = 2; i < 32; i++) registry.reserve(binding());
    expect(() => registry.reserve(binding())).toThrow(AnalysisBusyException);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(() => registry.reserve(first)).not.toThrow();
  });

  it('expires unused tickets without closing the connected sibling and releases final disconnect', async () => {
    const identity = binding();
    const grant = registry.reserve(identity);
    const stream = await registry.redeem(grant.controlTicket, 'control');
    const close = jest.fn();
    expect(registry.attach(stream, 'control', { close })).toBe(true);
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(
      registry.redeem(grant.analyzeTicket, 'analyze'),
    ).rejects.toThrow(UnauthorizedException);
    expect(close).not.toHaveBeenCalled();
    registry.detach(stream, 'control');
    expect(registry.isCurrent(stream)).toBe(false);
    expect(() => registry.reserve(identity)).not.toThrow();
  });

  it('closes both peers on revocation and cannot reopen on late validation success', async () => {
    const grant = registry.reserve(binding());
    const stream = await registry.redeem(grant.analyzeTicket, 'analyze');
    await registry.redeem(grant.controlTicket, 'control');
    const close = jest.fn();
    registry.attach(stream, 'analyze', { close });
    registry.attach(stream, 'control', { close });
    let resolve: () => void = () => undefined;
    validate.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await jest.advanceTimersByTimeAsync(1_000);
    expect(validate).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith('SERVICE_UNAVAILABLE');
    resolve();
    await Promise.resolve();
    expect(registry.isCurrent(stream)).toBe(false);
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it('does not close a valid sibling when redemption crosses only the ticket deadline', async () => {
    const grant = registry.reserve(binding());
    const stream = await registry.redeem(grant.controlTicket, 'control');
    const close = jest.fn();
    registry.attach(stream, 'control', { close });
    await jest.advanceTimersByTimeAsync(29_500);
    let resolve: () => void = () => undefined;
    validate.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const denied = expect(
      registry.redeem(grant.analyzeTicket, 'analyze'),
    ).rejects.toThrow(UnauthorizedException);
    await jest.advanceTimersByTimeAsync(1_000);
    resolve();
    await denied;
    expect(close).not.toHaveBeenCalled();
    expect(registry.isCurrent(stream)).toBe(true);
  });

  it('enforces absolute expiry despite continued successful identity validation', async () => {
    const grant = registry.reserve({
      ...binding(),
      expiresAt: Date.now() + 2_000,
    });
    const stream = await registry.redeem(grant.analyzeTicket, 'analyze');
    const close = jest.fn();
    registry.attach(stream, 'analyze', { close });
    await jest.advanceTimersByTimeAsync(2_000);
    expect(close).toHaveBeenCalledWith('expired');
    expect(registry.isCurrent(stream)).toBe(false);
  });

  it('clears pending grants and closes peers on shutdown', async () => {
    const grant = registry.reserve(binding());
    const stream = await registry.redeem(grant.analyzeTicket, 'analyze');
    const close = jest.fn();
    registry.attach(stream, 'analyze', { close });
    registry.onModuleDestroy();
    expect(close).toHaveBeenCalledWith('shutdown');
    await expect(
      registry.redeem(grant.controlTicket, 'control'),
    ).rejects.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
