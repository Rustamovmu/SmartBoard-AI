import { PROTOCOL_VERSION } from './platform-v1';

export const ANALYSIS_TRANSPORT = {
  ticketLifetimeMs: 30_000,
  inactivityMs: 30_000,
  revalidationMs: 1_000,
  validationTimeoutMs: 2_000,
  closeGraceMs: 1_000,
  maxMessageBytes: 8_192,
  maxOutboundBytes: 16_384,
  maxMessagesPerSecond: 5,
  maxStreams: 32,
  maxStreamsPerAccount: 2,
} as const;

export const ANALYSIS_CAPABILITIES = {
  vision: false,
  acceptsFrames: false,
} as const;
export type AnalysisEndpoint = 'analyze' | 'control';
export type AnalysisCommand = {
  protocolVersion: typeof PROTOCOL_VERSION;
  streamId: string;
  type: 'heartbeat' | 'status' | 'close';
};
export interface AnalysisGrant {
  protocolVersion: typeof PROTOCOL_VERSION;
  streamId: string;
  connectBefore: string;
  expiresAt: string;
  analyzeTicket: string;
  controlTicket: string;
  capabilities: typeof ANALYSIS_CAPABILITIES;
}

export function isAnalysisCommand(
  value: unknown,
  streamId: string,
): value is AnalysisCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    Object.keys(input).length === 3 &&
    input.protocolVersion === PROTOCOL_VERSION &&
    input.streamId === streamId &&
    ['heartbeat', 'status', 'close'].includes(input.type as string)
  );
}
