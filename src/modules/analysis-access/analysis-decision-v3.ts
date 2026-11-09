import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MEDIA_LIMITS,
  type MediaFrame,
  type MediaResult,
} from '../../contracts/analysis-media-v2';

export const DECISION_LIMITS = {
  stableMs: 2_000,
  cooldownMs: 3_000,
  candidateLifetimeMs: 30_000,
  maxPendingCandidates: 2,
  maxRememberedAcknowledgments: 64,
  signatureChangedPixelThreshold: 16,
  meaningfulChangedFraction: 0.025,
  meaningfulMeanDifference: 3.5,
  stableChangedFraction: 0.015,
  stableMeanDifference: 2.5,
  maximumCornerDrift: 0.01,
} as const;

export type DecisionState =
  | 'baseline_required'
  | 'baseline_accepted'
  | 'quality_rejected'
  | 'obstructed'
  | 'tracking_uncertain'
  | 'unchanged'
  | 'stabilizing'
  | 'cooldown'
  | 'candidate_ready'
  | 'candidate_pending';

export interface CandidateRecord {
  readonly candidateId: string;
  readonly streamId: string;
  readonly expiresAt: number;
  readonly packet: Buffer;
  readonly signature: Buffer;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onExpire: () => void;
}

function difference(left: Buffer, right: Buffer) {
  if (
    left.length !== MEDIA_LIMITS.signatureBytes ||
    right.length !== MEDIA_LIMITS.signatureBytes
  )
    throw new Error('Invalid comparison signature.');
  let changed = 0;
  let total = 0;
  for (let i = 0; i < left.length; i++) {
    const delta = Math.abs(left[i] - right[i]);
    total += delta;
    if (delta >= DECISION_LIMITS.signatureChangedPixelThreshold) changed++;
  }
  return {
    changedFraction: changed / left.length,
    meanDifference: total / left.length,
  };
}

function cornersMatch(left: number[][], right: number[][]): boolean {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every(
      (point, i) =>
        point.length === 2 &&
        right[i]?.length === 2 &&
        Math.max(
          Math.abs(point[0] - right[i][0]),
          Math.abs(point[1] - right[i][1]),
        ) <= DECISION_LIMITS.maximumCornerDrift,
    )
  );
}

export class CaptureDecisionState {
  private accepted?: Buffer;
  private previous?: Buffer;
  private acceptedCorners?: number[][];
  private stableSince?: number;
  private lastAcknowledgedAt = Number.NEGATIVE_INFINITY;
  private state: DecisionState = 'baseline_required';

  get currentState(): DecisionState {
    return this.state;
  }
  get hasBaseline(): boolean {
    return !!this.accepted;
  }

  acceptBaseline(signature: Buffer, corners: number[][]): void {
    if (this.accepted) throw new Error('Baseline already accepted.');
    if (signature.length !== MEDIA_LIMITS.signatureBytes)
      throw new Error('Invalid comparison signature.');
    this.accepted = Buffer.from(signature);
    this.previous = Buffer.from(signature);
    this.acceptedCorners = corners.map((point) => [...point]);
    this.state = 'baseline_accepted';
    this.stableSince = undefined;
  }

  observe(frame: MediaFrame, result: MediaResult, now: number): DecisionState {
    if (!this.accepted || !this.acceptedCorners) {
      this.state = 'baseline_required';
      return this.state;
    }
    if (!cornersMatch(this.acceptedCorners, frame.corners)) {
      this.resetStability(result.comparisonSignature);
      this.state = 'tracking_uncertain';
      return this.state;
    }
    const measurements = result.measurements;
    const quality = measurements.quality as Record<string, unknown>;
    if (
      !quality ||
      quality.focus_uncertain !== false ||
      !Array.isArray(quality.concerns) ||
      quality.concerns.length > 0 ||
      typeof quality.sharpness !== 'number' ||
      quality.sharpness < 25 ||
      typeof quality.brightness !== 'number' ||
      quality.brightness < 45 ||
      quality.brightness > 245
    ) {
      this.resetStability(result.comparisonSignature);
      this.state = 'quality_rejected';
      return this.state;
    }
    const people = measurements.people as Record<string, unknown>;
    if (
      !people ||
      people.status !== 'available' ||
      measurements.visibility !== 'no_detected_obstruction' ||
      measurements.person_box_overlap_fraction !== 0
    ) {
      this.resetStability(result.comparisonSignature);
      this.state = 'obstructed';
      return this.state;
    }
    const changed = difference(this.accepted, result.comparisonSignature);
    if (
      changed.changedFraction < DECISION_LIMITS.meaningfulChangedFraction ||
      changed.meanDifference < DECISION_LIMITS.meaningfulMeanDifference
    ) {
      this.resetStability(result.comparisonSignature);
      this.state = 'unchanged';
      return this.state;
    }
    const recent = this.previous
      ? difference(this.previous, result.comparisonSignature)
      : undefined;
    this.previous?.fill(0);
    this.previous = Buffer.from(result.comparisonSignature);
    if (
      !recent ||
      recent.changedFraction > DECISION_LIMITS.stableChangedFraction ||
      recent.meanDifference > DECISION_LIMITS.stableMeanDifference
    ) {
      this.stableSince = now;
      this.state = 'stabilizing';
      return this.state;
    }
    if (this.stableSince === undefined) this.stableSince = now;
    if (now - this.stableSince < DECISION_LIMITS.stableMs) {
      this.state = 'stabilizing';
      return this.state;
    }
    if (now - this.lastAcknowledgedAt < DECISION_LIMITS.cooldownMs) {
      this.state = 'cooldown';
      return this.state;
    }
    this.state = 'candidate_ready';
    return this.state;
  }

  acknowledge(signature: Buffer, now: number): void {
    if (signature.length !== MEDIA_LIMITS.signatureBytes)
      throw new Error('Invalid comparison signature.');
    this.accepted?.fill(0);
    this.previous?.fill(0);
    this.accepted = Buffer.from(signature);
    this.previous = Buffer.from(signature);
    this.lastAcknowledgedAt = now;
    this.stableSince = undefined;
    this.state = 'unchanged';
  }

  candidatePending(): void {
    this.state = 'candidate_pending';
  }

  candidateExpired(): void {
    if (this.state === 'candidate_pending') this.state = 'candidate_ready';
  }

  close(): void {
    this.accepted?.fill(0);
    this.previous?.fill(0);
    this.accepted = undefined;
    this.previous = undefined;
    this.acceptedCorners = undefined;
    this.stableSince = undefined;
    this.state = 'baseline_required';
  }

  private resetStability(signature: Buffer): void {
    this.previous?.fill(0);
    this.previous = Buffer.from(signature);
    this.stableSince = undefined;
  }
}

@Injectable()
export class AnalysisCandidateService implements OnModuleDestroy {
  private readonly candidates = new Map<string, CandidateRecord>();
  get pendingCount(): number {
    return this.candidates.size;
  }

  issue(
    streamId: string,
    signature: Buffer,
    onExpire: () => void,
    createPacket: (candidateId: string, expiresAt: number) => Buffer,
  ): CandidateRecord | undefined {
    if (this.candidates.size >= DECISION_LIMITS.maxPendingCandidates)
      return undefined;
    const candidateId = randomUUID();
    const expiresAt = Date.now() + DECISION_LIMITS.candidateLifetimeMs;
    const packet = createPacket(candidateId, expiresAt);
    const timer = setTimeout(() => {
      const candidate = this.candidates.get(candidateId);
      if (!candidate) return;
      this.clear(candidate);
      onExpire();
    }, DECISION_LIMITS.candidateLifetimeMs);
    const candidate: CandidateRecord = {
      candidateId,
      streamId,
      expiresAt,
      packet,
      signature: Buffer.from(signature),
      timer,
      onExpire,
    };
    this.candidates.set(candidateId, candidate);
    return candidate;
  }

  find(streamId: string, candidateId: string): CandidateRecord | undefined {
    const candidate = this.candidates.get(candidateId);
    return candidate?.streamId === streamId ? candidate : undefined;
  }

  acknowledge(streamId: string, candidateId: string): Buffer | undefined {
    const candidate = this.find(streamId, candidateId);
    if (!candidate) return undefined;
    this.candidates.delete(candidateId);
    clearTimeout(candidate.timer);
    candidate.packet.fill(0);
    const signature = Buffer.from(candidate.signature);
    candidate.signature.fill(0);
    return signature;
  }

  clearStream(streamId: string): void {
    for (const candidate of this.candidates.values())
      if (candidate.streamId === streamId) this.clear(candidate);
  }

  private clear(candidate: CandidateRecord): void {
    this.candidates.delete(candidate.candidateId);
    clearTimeout(candidate.timer);
    candidate.packet.fill(0);
    candidate.signature.fill(0);
  }

  onModuleDestroy(): void {
    for (const candidate of this.candidates.values()) this.clear(candidate);
  }
}
