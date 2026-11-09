import { UnauthorizedException } from '@nestjs/common';
import { WebSocket, type RawData } from 'ws';
import {
  ANALYSIS_CAPABILITIES,
  ANALYSIS_TRANSPORT,
  isAnalysisCommand,
  type AnalysisEndpoint,
} from '../../contracts/analysis-transport-v1';
import {
  MEDIA_LIMITS,
  encodeMediaResult,
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
  private timer?: ReturnType<typeof setTimeout>;
  private get version(): 1 | 2 {
    return this.stream.protocolVersion ?? 1;
  }
  private get capabilities() {
    if (this.version === 1) return ANALYSIS_CAPABILITIES;
    return {
      vision: !!this.media?.available,
      acceptsFrames: this.endpoint === 'analyze' && !!this.media?.available,
      automaticCapture: false,
    };
  }
  private get outboundLimit(): number {
    return this.version === 2
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
  ) {
    socket.on('error', () => this.finish(1011, 'SERVICE_UNAVAILABLE'));
    socket.on('close', () => {
      this.closing = true;
      this.abort.abort();
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
    if (binary && (this.version !== 2 || this.endpoint !== 'analyze')) {
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
        });
    } finally {
      this.busy = false;
    }
  }
  private async analyze(bytes: Buffer) {
    let lease: MediaLease | undefined;
    let output: Buffer | undefined;
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
        frame = parseMediaFrame(
          bytes,
          this.stream.id,
          this.lastFrameId,
          this.lastSourceTime,
        );
      } catch {
        this.finish(1008, 'VALIDATION_ERROR');
        return;
      }
      if (!this.media) {
        this.finish(1011, 'VISION_UNAVAILABLE');
        return;
      }
      // Global admission happens before async auth, bounding retained input frames too.
      lease = this.media.acquire(this.abort.signal);
      lease.signal.addEventListener('abort', workerAborted, { once: true });
      this.lastActivity = Date.now();
      this.lastFrameId = frame.frameId;
      this.lastSourceTime = frame.sourceTimeMs;
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
      output = encodeMediaResult(frame, result);
      await this.sendResult(output, lease.signal);
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
      output?.fill(0);
      lease?.signal.removeEventListener('abort', workerAborted);
      // Idempotent: cancel after a released lease cannot affect a later job.
      lease?.cancel();
      this.frameInFlight = false;
    }
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
