import { randomUUID } from 'node:crypto';
import {
  encodeDecisionCandidate,
  parseDecisionFrame,
  parseMediaFrame,
  strictJson,
  type MediaResult,
} from './analysis-media-v2';

const jpeg320x240 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x01, 0x01,
  0x11, 0x00, 0xff, 0xd9,
]);

function packet(header: Record<string, unknown>, image = jpeg320x240) {
  const content = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(content.length);
  return Buffer.concat([prefix, content, image]);
}

function header(streamId = randomUUID()) {
  return {
    protocolVersion: 2,
    type: 'frame',
    streamId,
    frameId: 1,
    sourceTimeMs: 100,
    width: 320,
    height: 240,
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
}
function decisionHeader(streamId = randomUUID(), type = 'frame') {
  return {
    ...header(streamId),
    protocolVersion: 3,
    type,
    captureMode: 'mounted',
  };
}

describe('bounded native media envelopes', () => {
  it('strictly decodes a frame envelope and matching JPEG dimensions', () => {
    const streamId = randomUUID();
    const frame = parseMediaFrame(packet(header(streamId)), streamId, 0, 0);
    expect(frame).toMatchObject({
      protocolVersion: 2,
      streamId,
      frameId: 1,
      sourceTimeMs: 100,
      width: 320,
      height: 240,
    });
    expect(frame.jpeg).toEqual(jpeg320x240);
  });

  it.each([
    ['unknown fields', { note: 'synthetic-private-marker' }],
    ['wrong stream', { streamId: randomUUID() }],
    ['wrong protocol', { protocolVersion: 1 }],
    ['unsafe dimensions', { width: 8192, height: 8192 }],
    [
      'bad corners',
      {
        corners: [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
        ],
      },
    ],
  ])('rejects %s before decoding', (_name, extra) => {
    const streamId = randomUUID();
    expect(() =>
      parseMediaFrame(
        packet({ ...header(streamId), ...extra }),
        streamId,
        0,
        0,
      ),
    ).toThrow();
  });

  it('rejects duplicate keys, including escaped aliases', () => {
    expect(() =>
      strictJson(Buffer.from('{"type":"frame","t\\u0079pe":"status"}')),
    ).toThrow();
  });

  it('rejects JPEG headers whose claimed source dimensions differ', () => {
    const streamId = randomUUID();
    expect(() =>
      parseMediaFrame(
        packet({ ...header(streamId), width: 640 }, jpeg320x240),
        streamId,
        0,
        0,
      ),
    ).toThrow();
  });

  it('requires mounted mode and distinguishes the phone-owned baseline packet', () => {
    const streamId = randomUUID();
    const parsed = parseDecisionFrame(
      packet(decisionHeader(streamId, 'baseline')),
      streamId,
      0,
      0,
    );
    expect(parsed).toMatchObject({ protocolVersion: 3, type: 'baseline' });
    expect(() =>
      parseDecisionFrame(
        packet({ ...decisionHeader(streamId), captureMode: 'handheld' }),
        streamId,
        0,
        0,
      ),
    ).toThrow();
  });

  it('encodes candidate identity and both actual derived image buffers', () => {
    const streamId = randomUUID();
    const mediaFrame = parseDecisionFrame(
      packet(decisionHeader(streamId)),
      streamId,
      0,
      0,
    );
    const result: MediaResult = {
      measurements: {
        tracking: 'unverified',
        automatic_capture_eligible: false,
      },
      rectified: Buffer.from([255, 216, 255, 217]),
      enhanced: Buffer.from([255, 216, 255, 217]),
      comparisonSignature: Buffer.alloc(1536),
    };
    const candidateId = randomUUID();
    const output = encodeDecisionCandidate(
      mediaFrame,
      result,
      candidateId,
      '2026-11-09T00:00:30.000Z',
    );
    const headerBytes = output.readUInt32BE(0);
    const parsed = JSON.parse(
      output.subarray(4, headerBytes + 4).toString('utf8'),
    );
    expect(parsed).toMatchObject({
      protocolVersion: 3,
      type: 'candidate',
      streamId,
      candidateId,
      frameId: 1,
      rectifiedBytes: 4,
      enhancedBytes: 4,
    });
    expect(output.subarray(4 + headerBytes)).toEqual(
      Buffer.from([255, 216, 255, 217, 255, 216, 255, 217]),
    );
    output.fill(0);
    result.comparisonSignature.fill(0);
  });
});
