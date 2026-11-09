import { WebSocket, type RawData } from 'ws';
import {
  ANALYSIS_CAPABILITIES,
  ANALYSIS_TRANSPORT,
  isAnalysisCommand,
  type AnalysisEndpoint,
} from '../../contracts/analysis-transport-v1';
import { PROTOCOL_VERSION } from '../../contracts/platform-v1';
import { ANALYSIS_ERRORS, type AnalysisErrorCode } from './analysis.errors';
import type {
  AnalysisPeer,
  AnalysisRegistryService,
  AnalysisStream,
  StreamCloseReason,
} from './analysis-registry.service';

/** Only bounded command envelopes are decoded. No media decoder or persistence. */
export class AnalysisSocketPeer implements AnalysisPeer {
  private closing = false;
  private lastActivity = Date.now();
  private windowStarted = Date.now();
  private messages = 0;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly socket: WebSocket,
    private readonly stream: AnalysisStream,
    private readonly endpoint: AnalysisEndpoint,
    private readonly registry: AnalysisRegistryService,
    private readonly detached: () => void,
  ) {
    socket.on('error', () => this.finish(1011, 'SERVICE_UNAVAILABLE'));
    socket.on('close', () => {
      this.closing = true;
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
      capabilities: ANALYSIS_CAPABILITIES,
    });
  }

  checkIdle() {
    if (
      !this.closing &&
      Date.now() - this.lastActivity >= ANALYSIS_TRANSPORT.inactivityMs
    )
      this.finish(1000);
  }

  private receive(raw: RawData, binary: boolean) {
    if (this.closing || !this.registry.isCurrent(this.stream)) return;
    if (Date.now() >= this.stream.binding.expiresAt) {
      this.close('expired');
      return;
    }
    if (Date.now() - this.lastActivity >= ANALYSIS_TRANSPORT.inactivityMs) {
      this.finish(1000);
      return;
    }
    if (binary) {
      this.finish(1003, 'VISION_UNAVAILABLE');
      return;
    }
    if (Date.now() - this.windowStarted >= 1_000) {
      this.windowStarted = Date.now();
      this.messages = 0;
    }
    if (
      ++this.messages > ANALYSIS_TRANSPORT.maxMessagesPerSecond ||
      this.busy
    ) {
      this.finish(1013, 'ANALYSIS_BUSY');
      return;
    }
    const bytes = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw);
    if (bytes.length > ANALYSIS_TRANSPORT.maxMessageBytes) {
      this.finish(1009, 'VALIDATION_ERROR');
      return;
    }
    let command: unknown;
    try {
      command = JSON.parse(bytes.toString('utf8'));
    } catch {
      this.finish(1008, 'VALIDATION_ERROR');
      return;
    }
    if (!isAnalysisCommand(command, this.stream.id)) {
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
          capabilities: ANALYSIS_CAPABILITIES,
          code: 'VISION_UNAVAILABLE',
        });
    } finally {
      this.busy = false;
    }
  }

  private send(type: string, fields: Record<string, unknown> = {}): boolean {
    if (this.closing || this.socket.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      streamId: this.stream.id,
      type,
      ...fields,
    });
    if (
      this.socket.bufferedAmount + Buffer.byteLength(text) >
      ANALYSIS_TRANSPORT.maxOutboundBytes
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
    // Mark first, so failed/error sends cannot recursively close or queue work.
    this.closing = true;
    if (this.socket.readyState === WebSocket.OPEN) {
      const text = JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        streamId: this.stream.id,
        type: error ? 'error' : 'closed',
        ...(error ? { code: error, message: ANALYSIS_ERRORS[error] } : {}),
      });
      if (
        this.socket.bufferedAmount + Buffer.byteLength(text) <=
        ANALYSIS_TRANSPORT.maxOutboundBytes
      )
        this.socket.send(text, () => undefined);
      this.socket.close(code, error ?? 'Connection closed.');
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
