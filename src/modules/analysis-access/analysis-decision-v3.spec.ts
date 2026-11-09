import { randomUUID } from 'node:crypto';
import {
  MEDIA_LIMITS,
  type MediaFrame,
  type MediaResult,
} from '../../contracts/analysis-media-v2';
import {
  AnalysisCandidateService,
  CaptureDecisionState,
} from './analysis-decision-v3';

const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const frame = (overrides: Partial<MediaFrame> = {}): MediaFrame => ({
  protocolVersion: 3,
  type: 'frame',
  streamId: randomUUID(),
  frameId: 1,
  sourceTimeMs: 100,
  width: 320,
  height: 240,
  corners,
  captureMode: 'mounted',
  jpeg: Buffer.alloc(4),
  ...overrides,
});
const result = (
  signature: Buffer,
  overrides: Record<string, unknown> = {},
): MediaResult => ({
  comparisonSignature: signature,
  rectified: Buffer.alloc(0),
  enhanced: Buffer.alloc(0),
  measurements: {
    quality: {
      focus_uncertain: false,
      concerns: [],
      sharpness: 40,
      brightness: 120,
    },
    people: { status: 'available' },
    visibility: 'no_detected_obstruction',
    person_box_overlap_fraction: 0,
    ...overrides,
  },
});

describe('mounted-camera capture decision lifecycle', () => {
  it('requires a phone supplied baseline and rejects handheld corner drift', () => {
    const decision = new CaptureDecisionState();
    const signature = Buffer.alloc(MEDIA_LIMITS.signatureBytes);
    expect(decision.observe(frame(), result(signature), 0)).toBe(
      'baseline_required',
    );
    decision.acceptBaseline(signature, corners);
    const shifted = corners.map((point) => [point[0] + 0.02, point[1]]);
    expect(
      decision.observe(
        frame({ corners: shifted, frameId: 2 }),
        result(Buffer.alloc(MEDIA_LIMITS.signatureBytes, 90)),
        1_000,
      ),
    ).toBe('tracking_uncertain');
    decision.close();
    signature.fill(0);
  });

  it('requires useful quality, fresh available person inference and no obstruction', () => {
    const signature = Buffer.alloc(MEDIA_LIMITS.signatureBytes);
    const changed = Buffer.alloc(MEDIA_LIMITS.signatureBytes, 90);
    const decision = new CaptureDecisionState();
    decision.acceptBaseline(signature, corners);
    expect(
      decision.observe(
        frame(),
        result(changed, {
          quality: {
            focus_uncertain: false,
            concerns: ['possible_blur'],
            sharpness: 3,
            brightness: 120,
          },
        }),
        1_000,
      ),
    ).toBe('quality_rejected');
    expect(
      decision.observe(
        frame({ frameId: 2 }),
        result(changed, {
          people: { status: 'unavailable' },
          visibility: 'unknown',
          person_box_overlap_fraction: null,
        }),
        1_100,
      ),
    ).toBe('obstructed');
    expect(
      decision.observe(
        frame({ frameId: 3 }),
        result(changed, {
          visibility: 'detected_obstruction',
          person_box_overlap_fraction: 0.12,
        }),
        1_200,
      ),
    ).toBe('obstructed');
    decision.close();
    signature.fill(0);
    changed.fill(0);
  });

  it('waits for two seconds of stable meaningful change and advances only on acknowledgment', () => {
    const baseline = Buffer.alloc(MEDIA_LIMITS.signatureBytes);
    const changed = Buffer.alloc(MEDIA_LIMITS.signatureBytes, 90);
    const decision = new CaptureDecisionState();
    decision.acceptBaseline(baseline, corners);
    expect(decision.observe(frame(), result(changed), 1_000)).toBe(
      'stabilizing',
    );
    expect(
      decision.observe(frame({ frameId: 2 }), result(changed), 2_999),
    ).toBe('stabilizing');
    expect(
      decision.observe(frame({ frameId: 3 }), result(changed), 3_000),
    ).toBe('candidate_ready');
    decision.acknowledge(changed, 3_100);
    expect(
      decision.observe(frame({ frameId: 4 }), result(changed), 6_200),
    ).toBe('unchanged');
    const next = Buffer.alloc(MEDIA_LIMITS.signatureBytes, 180);
    expect(decision.observe(frame({ frameId: 5 }), result(next), 6_300)).toBe(
      'stabilizing',
    );
    expect(decision.observe(frame({ frameId: 6 }), result(next), 8_301)).toBe(
      'candidate_ready',
    );
    decision.close();
    baseline.fill(0);
    changed.fill(0);
    next.fill(0);
  });
});

describe('bounded transient candidate slots', () => {
  let service: AnalysisCandidateService;
  beforeEach(() => {
    jest.useFakeTimers();
    service = new AnalysisCandidateService();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('bounds pending candidate packets, supports retries and acknowledges idempotently in the stream', () => {
    const signature = Buffer.alloc(MEDIA_LIMITS.signatureBytes, 12);
    const first = service.issue('stream-a', signature, jest.fn(), () =>
      Buffer.from('candidate-a'),
    )!;
    const second = service.issue('stream-b', signature, jest.fn(), () =>
      Buffer.from('candidate-b'),
    )!;
    expect(service.pendingCount).toBe(2);
    expect(
      service.issue('stream-c', signature, jest.fn(), () =>
        Buffer.from('candidate-c'),
      ),
    ).toBeUndefined();
    expect(service.find('stream-a', first.candidateId)?.packet).toEqual(
      Buffer.from('candidate-a'),
    );
    expect(service.find('stream-b', first.candidateId)).toBeUndefined();
    expect(service.acknowledge('stream-b', first.candidateId)).toBeUndefined();
    expect(service.acknowledge('stream-a', first.candidateId)).toEqual(
      signature,
    );
    expect(service.pendingCount).toBe(1);
    service.clearStream('stream-b');
    expect(service.pendingCount).toBe(0);
    expect(second.packet.every((byte) => byte === 0)).toBe(true);
    signature.fill(0);
  });

  it('clears an unacknowledged candidate at expiry without advancing a baseline', () => {
    const expired = jest.fn();
    const candidate = service.issue(
      'stream-expire',
      Buffer.alloc(MEDIA_LIMITS.signatureBytes),
      expired,
      () => Buffer.from('temporary-candidate'),
    )!;
    jest.advanceTimersByTime(30_000);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(
      service.find('stream-expire', candidate.candidateId),
    ).toBeUndefined();
    expect(candidate.packet.every((byte) => byte === 0)).toBe(true);
  });
});
