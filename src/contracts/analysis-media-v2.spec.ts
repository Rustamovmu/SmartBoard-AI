import { randomUUID } from 'node:crypto';
import { parseMediaFrame, strictJson } from './analysis-media-v2';

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
});
