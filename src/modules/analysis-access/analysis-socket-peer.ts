import { UnauthorizedException } from '@nestjs/common';
import { WebSocket, type RawData } from 'ws';
import {
  ANALYSIS_CAPABILITIES,
  ANALYSIS_TRANSPORT,
  isAnalysisCommand,
  type AnalysisEndpoint,
} from '../../contracts/analysis-transport-v1';
import {
  DECISION_CAPABILITIES,
  MEDIA_LIMITS,
  encodeDecisionCandidate,
  encodeMediaResult,
  parseDecisionFrame,
  parseMediaFrame,
  strictJson,
  type MediaFrame,
} from '../../contracts/analysis-media-v2';
import {
  ANALYSIS_ERRORS,
  AnalysisBusyException,
  MediaValidationError,
  type AnalysisErrorCode,
} from './analysis.errors';
import type {
  AnalysisPeer,
  AnalysisRegistryService,
  AnalysisStream,
  StreamCloseReason,
} from './analysis-registry.service';
import type {
  AnalysisMediaService,
  MediaLease,
} from './analysis-media.service';
import {
  AnalysisCandidateService,
  CaptureDecisionState,
  DECISION_LIMITS,
} from './analysis-decision-v3';

export class AnalysisSocketPeer implements AnalysisPeer {
  private closing = false;
  private lastActivity = Date.now();
  private windowStarted = Date.now();
  private messages = 0;
  private busy = false;
  private frameInFlight = false;
  private lastFrameId = 0;
  private lastSourceTime = 0;
  private readonly abort = new AbortController();
  private readonly captureDecision = new CaptureDecisionState();
  private pendingCandidateId?: string;
  private readonly acknowledged = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private get version(): 1 | 2 | 3 {
    return this.stream.protocolVersion ?? 1;
  }
  private get capabilities() {
    if (this.version === 1) return ANALYSIS_CAPABILITIES;
    if (this.version === 3)
      return {
        ...DECISION_CAPABILITIES,
        vision: !!this.media?.available,
        acceptsFrames: this.endpoint === 'analyze' && !!this.media?.available,
        captureCandidates:
          this.endpoint === 'analyze' && !!this.media?.available,
      };
    return {
      vision: !!this.media?.available,
      acceptsFrames: this.endpoint === 'analyze' && !!this.media?.available,
      automaticCapture: false,
    };
  }
  private get outboundLimit(): number {
    return this.version >= 2
      ? MEDIA_LIMITS.outboundBytes
      : ANALYSIS_TRANSPORT.maxOutboundBytes;
  }

  constructor(
    readonly socket: WebSocket,
    private readonly stream: AnalysisStream,
    private readonly endpoint: AnalysisEndpoint,
    private readonly registry: AnalysisRegistryService,
    private readonly detached: () => void,
    private readonly media?: AnalysisMediaService,
    private readonly candidates?: AnalysisCandidateService,
  ) {
    socket.on('error', () => this.finish(1011, 'SERVICE_UNAVAILABLE'));
    socket.on('close', () => {
      this.closing = true;
      this.abort.abort();
      if (this.endpoint === 'analyze') {
        this.candidates?.clearStream(this.stream.id);
        this.captureDecision.close();
        this.pendingCandidateId = undefined;
        this.acknowledged.clear();
      }
      if (this.timer) clearTimeout(this.timer);
      registry.detach(stream, endpoint);
      detached();
    });
    socket.on('message', (raw: RawData, binary: boolean) =>
      this.receive(raw, binary),
    );
  }
  ready() {
    this.send('ready', {
      endpoint: this.endpoint,
      expiresAt: new Date(this.stream.binding.expiresAt).toISOString(),
      capabilities: this.capabilities,
    });
  }
  checkIdle() {
    if (
      !this.closing &&
      Date.now() - this.lastActivity >= ANALYSIS_TRANSPORT.inactivityMs
    )
      this.finish(1000);
  }
  private current(): boolean {
    return (
      !this.closing &&
      !this.abort.signal.aborted &&
      this.socket.readyState === WebSocket.OPEN &&
      this.registry.isCurrent(this.stream) &&
      Date.now() < this.stream.binding.expiresAt
    );
  }
  private receive(raw: RawData, binary: boolean) {
    if (this.closing || !this.registry.isCurrent(this.stream)) return;
    const bytes = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw);
    if (
      Date.now() >= this.stream.binding.expiresAt ||
      Date.now() - this.lastActivity >= ANALYSIS_TRANSPORT.inactivityMs
    ) {
      bytes.fill(0);
      this.finish(1000);
      return;
    }
    if (binary && (this.version < 2 || this.endpoint !== 'analyze')) {
      bytes.fill(0);
      this.finish(1003, 'VISION_UNAVAILABLE');
      return;
    }
    if (Date.now() - this.windowStarted >= 1000) {
      this.windowStarted = Date.now();
      this.messages = 0;
    }
    if (
      ++this.messages > ANALYSIS_TRANSPORT.maxMessagesPerSecond ||
      this.busy
    ) {
      bytes.fill(0);
      this.finish(1013, 'ANALYSIS_BUSY');
      return;
    }
    if (binary) {
      if (this.frameInFlight) {
        bytes.fill(0);
        this.finish(1013, 'ANALYSIS_BUSY');
        return;
      }
      this.frameInFlight = true;
      void this.analyze(bytes);
      return;
    }
    if (bytes.length > ANALYSIS_TRANSPORT.maxMessageBytes) {
      bytes.fill(0);
      this.finish(1009, 'VALIDATION_ERROR');
      return;
    }
    let command: unknown;
    try {
      command = strictJson(bytes);
    } catch {
      this.finish(1008, 'VALIDATION_ERROR');
      return;
    } finally {
      bytes.fill(0);
    }
    if (!isAnalysisCommand(command, this.stream.id, this.version)) {
      if (this.version === 3 && this.handleDecisionCommand(command)) return;
      this.finish(1008, 'VALIDATION_ERROR');
      return;
    }
    this.busy = true;
    this.lastActivity = Date.now();
    try {
      if (command.type === 'close') this.finish(1000);
      else
        this.send('status', {
          state: 'connected',
          capabilities: this.capabilities,
          ...(!this.capabilities.vision ? { code: 'VISION_UNAVAILABLE' } : {}),
          ...(this.version === 3
            ? {
                decisionState: this.captureDecision.currentState,
                ...(this.pendingCandidateId
                  ? { candidateId: this.pendingCandidateId }
                  : {}),
              }
            : {}),
        });
    } finally {
      this.busy = false;
    }
  }
  private async analyze(bytes: Buffer) {
    let lease: MediaLease | undefined;
    let output: Buffer | undefined;
    let candidatePacketRetained = false;
    const workerAborted = () => {
      if (!this.closing) {
        if (lease?.signal.reason instanceof MediaValidationError)
          this.finish(1008, 'VALIDATION_ERROR');
        else this.finish(1011, 'VISION_UNAVAILABLE');
      }
    };
    try {
      let frame: MediaFrame;
      try {
        frame =
          this.version === 3
            ? parseDecisionFrame(
                bytes,
                this.stream.id,
                this.lastFrameId,
                this.lastSourceTime,
              )
            : parseMediaFrame(
                bytes,
                this.stream.id,
                this.lastFrameId,
                this.lastSourceTime,
              );
      } catch {
        this.finish(1008, 'VALIDATION_ERROR');
        return;
      }
      this.lastFrameId = frame.frameId;
      this.lastSourceTime = frame.sourceTimeMs;
      this.lastActivity = Date.now();
      if (!this.media) {
        this.finish(1011, 'VISION_UNAVAILABLE');
        return;
      }
      if (this.version === 3 && this.pendingCandidateId) {
        this.send('status', {
          state: 'candidate_pending',
          candidateId: this.pendingCandidateId,
        });
        return;
      }
      if (
        this.version === 3 &&
        frame.type === 'frame' &&
        !this.captureDecision.hasBaseline
      ) {
        this.send('status', { state: 'baseline_required' });
        return;
      }
      if (
        this.version === 3 &&
        frame.type === 'baseline' &&
        this.captureDecision.hasBaseline
      ) {
        this.send('error', {
          code: 'VALIDATION_ERROR',
          message: 'Baseline already supplied for this stream.',
        });
        return;
      }
      // Global admission happens before async auth, bounding retained input frames too.
      lease = this.media.acquire(this.abort.signal);
      lease.signal.addEventListener('abort', workerAborted, { once: true });
      await this.registry.validate(this.stream.binding, this.abort.signal);
      if (!this.current() || lease.signal.aborted)
        throw new UnauthorizedException();
      const pending = lease.run(frame);
      bytes.fill(0); // run() has synchronously copied the bounded stdin packet.
      const result = await pending;
      if (!this.current() || lease.signal.aborted)
        throw new UnauthorizedException();
      await this.registry.validate(this.stream.binding, this.abort.signal);
      if (!this.current() || lease.signal.aborted)
        throw new UnauthorizedException();
      if (this.version === 3 && frame.type === 'baseline') {
        this.captureDecision.acceptBaseline(
          result.comparisonSignature,
          frame.corners,
        );
        this.send('status', {
          state: 'baseline_accepted',
          frameId: frame.frameId,
          sourceTimeMs: frame.sourceTimeMs,
        });
        lease.release();
        return;
      }
      if (this.version === 3) {
        const state = this.captureDecision.observe(frame, result, Date.now());
        if (state !== 'candidate_ready' || !this.candidates) {
          this.send('status', {
            state,
            frameId: frame.frameId,
            sourceTimeMs: frame.sourceTimeMs,
          });
          lease.release();
          return;
        }
        const candidate = this.candidates.issue(
          this.stream.id,
          result.comparisonSignature,
          () => {
            if (this.pendingCandidateId) {
              this.pendingCandidateId = undefined;
              this.captureDecision.candidateExpired();
              if (!this.closing)
                this.send('status', { state: 'candidate_expired' });
            }
          },
          (candidateId, expiresAt) =>
            encodeDecisionCandidate(
              frame,
              result,
              candidateId,
              new Date(expiresAt).toISOString(),
            ),
        );
        if (!candidate) {
          this.send('status', {
            state: 'candidate_delayed',
            frameId: frame.frameId,
          });
          lease.release();
          return;
        }
        this.pendingCandidateId = candidate.candidateId;
        this.captureDecision.candidatePending();
        candidatePacketRetained = true;
        await this.sendResult(candidate.packet, lease.signal);
        lease.release();
      } else {
        output = encodeMediaResult(frame, result);
        await this.sendResult(output, lease.signal);
        lease.release();
      }
      lease.release();
    } catch (error) {
      if (!this.closing) {
        if (error instanceof UnauthorizedException)
          this.finish(1008, 'UNAUTHENTICATED');
        else if (error instanceof MediaValidationError)
          this.finish(1008, 'VALIDATION_ERROR');
        else if (error instanceof AnalysisBusyException)
          this.finish(1013, 'ANALYSIS_BUSY');
        else this.finish(1011, 'VISION_UNAVAILABLE');
      }
    } finally {
      bytes.fill(0);
      if (!candidatePacketRetained) output?.fill(0);
      lease?.signal.removeEventListener('abort', workerAborted);
      // Idempotent: cancel after a released lease cannot affect a later job.
      lease?.cancel();
      this.frameInFlight = false;
    }
  }
  private handleDecisionCommand(value: unknown): boolean {
    // Candidate requests/acknowledgments are media lifecycle commands and must
    // never turn the command-only control endpoint into a binary result channel.
    if (this.endpoint !== 'analyze') return false;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const command = value as Record<string, unknown>;
    if (
      Object.keys(command).length === 4 &&
      command.protocolVersion === 3 &&
      command.streamId === this.stream.id &&
      command.type === 'candidateRequest' &&
      typeof command.candidateId === 'string'
    ) {
      const candidate = this.candidates?.find(
        this.stream.id,
        command.candidateId,
      );
      if (!candidate) {
        this.send('error', {
          code: 'STALE_CANDIDATE',
          message: 'Candidate is no longer available.',
        });
        return true;
      }
      this.lastActivity = Date.now();
      void this.sendStoredCandidate(candidate.packet).catch(() => {
        if (!this.closing) this.finish(1011, 'VISION_UNAVAILABLE');
      });
      return true;
    }
    if (
      Object.keys(command).length === 5 &&
      command.protocolVersion === 3 &&
      command.streamId === this.stream.id &&
      command.type === 'localSaveAcknowledged' &&
      typeof command.candidateId === 'string' &&
      typeof command.saveRequestId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        command.candidateId,
      ) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        command.saveRequestId,
      )
    ) {
      this.lastActivity = Date.now();
      if (
        this.acknowledged.get(command.candidateId) === command.saveRequestId
      ) {
        this.send('status', {
          state: 'candidate_saved',
          candidateId: command.candidateId,
          repeated: true,
        });
        return true;
      }
      if (this.pendingCandidateId !== command.candidateId) {
        this.send('error', {
          code: 'STALE_CANDIDATE',
          message: 'Candidate is no longer available.',
        });
        return true;
      }
      const signature = this.candidates?.acknowledge(
        this.stream.id,
        command.candidateId,
      );
      if (!signature) {
        this.send('error', {
          code: 'STALE_CANDIDATE',
          message: 'Candidate is no longer available.',
        });
        return true;
      }
      this.captureDecision.acknowledge(signature, Date.now());
      signature.fill(0);
      if (
        this.acknowledged.size >= DECISION_LIMITS.maxRememberedAcknowledgments
      ) {
        const oldest = this.acknowledged.keys().next().value;
        if (oldest) this.acknowledged.delete(oldest);
      }
      this.acknowledged.set(command.candidateId, command.saveRequestId);
      this.pendingCandidateId = undefined;
      this.send('status', {
        state: 'candidate_saved',
        candidateId: command.candidateId,
        repeated: false,
      });
      return true;
    }
    return false;
  }
  private sendStoredCandidate(packet: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.current()) {
        reject(new Error('Connection closed.'));
        return;
      }
      if (this.socket.bufferedAmount + packet.length > this.outboundLimit) {
        this.finish(1013, 'ANALYSIS_BUSY');
        reject(new Error('Connection busy.'));
        return;
      }
      this.socket.send(packet, { binary: true }, (error) => {
        if (error || !this.current()) reject(new Error('Connection closed.'));
        else resolve();
      });
    });
  }
  private sendResult(packet: Buffer, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.current() || signal.aborted) {
        reject(new Error('Connection closed.'));
        return;
      }
      if (this.socket.bufferedAmount + packet.length > this.outboundLimit) {
        this.finish(1013, 'ANALYSIS_BUSY');
        reject(new Error('Connection busy.'));
        return;
      }
      const aborted = () => reject(new Error('Connection closed.'));
      signal.addEventListener('abort', aborted, { once: true });
      this.socket.send(packet, { binary: true }, (error) => {
        signal.removeEventListener('abort', aborted);
        if (error || !this.current() || signal.aborted)
          reject(new Error('Connection closed.'));
        else resolve();
      });
    });
  }
  private send(type: string, fields: Record<string, unknown> = {}): boolean {
    if (this.closing || this.socket.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify({
      protocolVersion: this.version,
      streamId: this.stream.id,
      type,
      ...fields,
    });
    if (
      this.socket.bufferedAmount + Buffer.byteLength(text) >
      this.outboundLimit
    ) {
      this.finish(1013);
      return false;
    }
    this.socket.send(text, (error) => {
      if (error) this.finish(1011);
    });
    return true;
  }
  private finish(code: number, error?: AnalysisErrorCode) {
    if (this.closing) return;
    this.closing = true;
    if (this.socket.readyState === WebSocket.OPEN) {
      if (this.frameInFlight && this.socket.bufferedAmount > 0)
        this.socket.terminate();
      else {
        const text = JSON.stringify({
          protocolVersion: this.version,
          streamId: this.stream.id,
          type: error ? 'error' : 'closed',
          ...(error ? { code: error, message: ANALYSIS_ERRORS[error] } : {}),
        });
        if (
          this.socket.bufferedAmount + Buffer.byteLength(text) <=
          this.outboundLimit
        )
          this.socket.send(text, () => undefined);
        this.socket.close(code, error ?? 'Connection closed.');
      }
    }
    this.abort.abort();
    if (this.endpoint === 'analyze') {
      this.candidates?.clearStream(this.stream.id);
      this.captureDecision.close();
      this.pendingCandidateId = undefined;
      this.acknowledged.clear();
    }
    this.timer = setTimeout(
      () => this.socket.terminate(),
      ANALYSIS_TRANSPORT.closeGraceMs,
    );
    this.registry.detach(this.stream, this.endpoint);
  }
  close(reason: StreamCloseReason) {
    if (reason === 'shutdown') this.finish(1001);
    else if (reason === 'expired') this.finish(1000);
    else this.finish(reason === 'UNAUTHENTICATED' ? 1008 : 1011, reason);
  }
}
