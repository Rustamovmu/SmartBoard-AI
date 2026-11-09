import {
  Injectable,
  HttpException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ANALYSIS_CAPABILITIES,
  ANALYSIS_TRANSPORT,
  type AnalysisEndpoint,
  type AnalysisGrant,
} from '../../contracts/analysis-transport-v1';
import { MEDIA_CAPABILITIES } from '../../contracts/analysis-media-v2';
import { digest } from '../auth/token.service';
import { AnalysisConfig } from './analysis.config';
import { AnalysisBusyException } from './analysis.errors';
import {
  AnalysisIdentityService,
  type AnalysisBinding,
} from './analysis-identity.service';

export type StreamCloseReason =
  'UNAUTHENTICATED' | 'SERVICE_UNAVAILABLE' | 'expired' | 'shutdown';
export interface AnalysisPeer {
  close(reason: StreamCloseReason): void;
}
export interface AnalysisStream {
  readonly id: string;
  readonly protocolVersion: 1 | 2;
  readonly binding: AnalysisBinding;
  readonly connectBefore: number;
  readonly tickets: Map<AnalysisEndpoint, string>;
  readonly connecting: Set<AnalysisEndpoint>;
  readonly peers: Map<AnalysisEndpoint, AnalysisPeer>;
  checking: boolean;
  lastChecked: number;
}

@Injectable()
export class AnalysisRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly streams = new Map<string, AnalysisStream>();
  private readonly tickets = new Map<
    string,
    { stream: AnalysisStream; endpoint: AnalysisEndpoint }
  >();
  private readonly validationTimers = new Map<
    ReturnType<typeof setTimeout>,
    () => void
  >();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;

  constructor(
    private readonly config: AnalysisConfig,
    private readonly identity: AnalysisIdentityService,
  ) {}

  onModuleInit() {
    if (this.config.enabled) this.timer = setInterval(() => this.sweep(), 100);
  }

  reserve(binding: AnalysisBinding, protocolVersion: 1 | 2 = 1): AnalysisGrant {
    if (this.stopping || !this.config.enabled)
      throw new ServiceUnavailableException();
    this.sweep();
    if (binding.expiresAt <= Date.now()) throw new UnauthorizedException();
    const owned = [...this.streams.values()].filter(
      (s) => s.binding.userId === binding.userId,
    );
    if (
      this.streams.size >= ANALYSIS_TRANSPORT.maxStreams ||
      owned.length >= ANALYSIS_TRANSPORT.maxStreamsPerAccount ||
      [...this.streams.values()].some(
        (s) => s.binding.deviceId === binding.deviceId,
      )
    )
      throw new AnalysisBusyException();
    const stream: AnalysisStream = {
      id: randomUUID(),
      protocolVersion,
      binding: { ...binding },
      connectBefore: Math.min(
        Date.now() + ANALYSIS_TRANSPORT.ticketLifetimeMs,
        binding.expiresAt,
      ),
      tickets: new Map(),
      connecting: new Set(),
      peers: new Map(),
      checking: false,
      lastChecked: Date.now(),
    };
    this.streams.set(stream.id, stream);
    const issue = (endpoint: AnalysisEndpoint) => {
      const raw = randomBytes(32).toString('base64url');
      const hash = digest(raw);
      stream.tickets.set(endpoint, hash);
      this.tickets.set(hash, { stream, endpoint });
      return raw;
    };
    return {
      protocolVersion,
      streamId: stream.id,
      connectBefore: new Date(stream.connectBefore).toISOString(),
      expiresAt: new Date(binding.expiresAt).toISOString(),
      analyzeTicket: issue('analyze'),
      controlTicket: issue('control'),
      capabilities:
        protocolVersion === 2 ? MEDIA_CAPABILITIES : ANALYSIS_CAPABILITIES,
    };
  }

  isCurrent(stream: AnalysisStream) {
    return !this.stopping && this.streams.get(stream.id) === stream;
  }

  async validate(binding: AnalysisBinding, signal?: AbortSignal) {
    if (this.stopping) throw new ServiceUnavailableException();
    if (signal?.aborted) throw new UnauthorizedException();
    let abort: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.identity.validate(binding).catch((error: unknown) => {
          throw error instanceof HttpException
            ? error
            : new ServiceUnavailableException();
        }),
        new Promise<never>((_, reject) => {
          const cancel = () => reject(new ServiceUnavailableException());
          timer = setTimeout(cancel, ANALYSIS_TRANSPORT.validationTimeoutMs);
          this.validationTimers.set(timer, cancel);
          abort = () => reject(new UnauthorizedException());
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        }),
      ]);
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
      if (timer) {
        clearTimeout(timer);
        this.validationTimers.delete(timer);
      }
    }
  }

  async redeem(
    raw: string,
    endpoint: AnalysisEndpoint,
  ): Promise<AnalysisStream> {
    if (this.stopping || !this.config.enabled)
      throw new ServiceUnavailableException();
    this.sweep();
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new UnauthorizedException();
    const hash = digest(raw);
    const found = this.tickets.get(hash);
    if (!found || found.endpoint !== endpoint || !this.isCurrent(found.stream))
      throw new UnauthorizedException();
    const { stream } = found;
    // Consume before awaiting database work: simultaneous redemption has one winner.
    this.tickets.delete(hash);
    stream.tickets.delete(endpoint);
    stream.connecting.add(endpoint);
    try {
      await this.validate(stream.binding);
    } catch (error) {
      this.drop(
        stream,
        error instanceof UnauthorizedException
          ? 'UNAUTHENTICATED'
          : 'SERVICE_UNAVAILABLE',
      );
      throw error;
    }
    // A ticket deadline is endpoint-local. It must not revoke a valid sibling.
    if (
      !this.isCurrent(stream) ||
      Date.now() >= stream.connectBefore ||
      Date.now() >= stream.binding.expiresAt
    ) {
      this.detach(stream, endpoint);
      throw new UnauthorizedException();
    }
    return stream;
  }

  attach(
    stream: AnalysisStream,
    endpoint: AnalysisEndpoint,
    peer: AnalysisPeer,
  ): boolean {
    if (
      !this.isCurrent(stream) ||
      !stream.connecting.delete(endpoint) ||
      Date.now() >= stream.binding.expiresAt
    )
      return false;
    stream.peers.set(endpoint, peer);
    return true;
  }

  detach(stream: AnalysisStream, endpoint: AnalysisEndpoint) {
    stream.connecting.delete(endpoint);
    stream.peers.delete(endpoint);
    this.releaseIfEmpty(stream);
  }

  private releaseIfEmpty(stream: AnalysisStream) {
    if (!stream.peers.size && !stream.tickets.size && !stream.connecting.size)
      this.drop(stream, 'expired');
  }

  private sweep() {
    const now = Date.now();
    for (const stream of this.streams.values()) {
      if (now >= stream.binding.expiresAt) {
        this.drop(stream, 'expired');
        continue;
      }
      if (now >= stream.connectBefore) {
        for (const hash of stream.tickets.values()) this.tickets.delete(hash);
        stream.tickets.clear();
        this.releaseIfEmpty(stream);
      }
      if (
        !this.isCurrent(stream) ||
        stream.checking ||
        now - stream.lastChecked < ANALYSIS_TRANSPORT.revalidationMs
      )
        continue;
      stream.checking = true;
      stream.lastChecked = now;
      void this.validate(stream.binding)
        .catch((error: unknown) => {
          this.drop(
            stream,
            error instanceof UnauthorizedException
              ? 'UNAUTHENTICATED'
              : 'SERVICE_UNAVAILABLE',
          );
        })
        .finally(() => {
          stream.checking = false;
        });
    }
  }

  private drop(stream: AnalysisStream, reason: StreamCloseReason) {
    if (this.streams.get(stream.id) !== stream) return;
    this.streams.delete(stream.id);
    for (const hash of stream.tickets.values()) this.tickets.delete(hash);
    stream.tickets.clear();
    stream.connecting.clear();
    const peers = [...stream.peers.values()];
    stream.peers.clear();
    for (const peer of peers) peer.close(reason);
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const stream of this.streams.values()) this.drop(stream, 'shutdown');
    for (const [timer, cancel] of this.validationTimers) {
      clearTimeout(timer);
      cancel();
    }
    this.validationTimers.clear();
  }
}
