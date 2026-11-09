/** Native measurement transport, deliberately separate from V1 and capture decisions. */
export const MEDIA_LIMITS = {
  requestHeaderBytes: 8192,
  resultHeaderBytes: 32768,
  jpegBytes: 2_000_000,
  requestBytes: 2_008_196,
  resultBytes: 4_032_772,
  outboundBytes: 4_049_156,
  workers: 2,
  startupMs: 20_000,
  jobMs: 10_000,
  replacementMs: 1000,
} as const;
export const MEDIA_CAPABILITIES = {
  vision: true,
  acceptsFrames: true,
  automaticCapture: false,
} as const;
export interface MediaFrame {
  protocolVersion: 2;
  type: 'frame';
  streamId: string;
  frameId: number;
  sourceTimeMs: number;
  width: number;
  height: number;
  corners: number[][];
  jpeg: Buffer;
}
export interface MediaResult {
  measurements: Record<string, unknown>;
  rectified: Buffer;
  enhanced: Buffer;
}
export function record(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
export function numberIn(
  value: unknown,
  low: number,
  high: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= low &&
    value <= high
  );
}
export function integerIn(
  value: unknown,
  low: number,
  high: number,
): value is number {
  return numberIn(value, low, high) && Number.isSafeInteger(value);
}
export function validCorners(value: unknown): value is number[][] {
  if (!(
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n: unknown) => numberIn(n, 0, 1)),
    )
  ))
    return false;
  const edges = value.map((point, index) => {
    const next = value[(index + 1) % 4];
    return [next[0] - point[0], next[1] - point[1]] as const;
  });
  const twiceArea = value.reduce((area, point, index) => {
    const next = value[(index + 1) % 4];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return (
    twiceArea >= 0.05 &&
    edges.every(([x, y]) => Math.hypot(x, y) >= 0.025) &&
    edges.every((edge, index) => {
      const next = edges[(index + 1) % 4];
      return edge[0] * next[1] - edge[1] * next[0] > 0;
    })
  );
}
/** JSON.parse alone silently discards duplicate keys. Scan only already-valid JSON. */
export function strictJson(bytes: Buffer): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(new Set());
    else if (text[i] === '[') stack.push(null);
    else if (text[i] === '}' || text[i] === ']') stack.pop();
    else if (text[i] === '"') {
      const start = i++;
      for (; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      let next = i + 1;
      while (/\s/.test(text[next] ?? '') && next < text.length) next++;
      if (text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        const keys = stack.at(-1);
        if (!keys || keys.has(key)) throw new Error('Invalid JSON.');
        keys.add(key);
      }
    }
  }
  return value;
}
export function parseMediaFrame(
  bytes: Buffer,
  streamId: string,
  lastId: number,
  lastTime: number,
): MediaFrame {
  if (bytes.length < 5 || bytes.length > MEDIA_LIMITS.requestBytes)
    throw new Error('Invalid frame.');
  const length = bytes.readUInt32BE(0);
  if (
    length < 1 ||
    length > MEDIA_LIMITS.requestHeaderBytes ||
    bytes.length <= length + 4
  )
    throw new Error('Invalid frame.');
  const value = strictJson(bytes.subarray(4, length + 4));
  if (
    !record(value, [
      'protocolVersion',
      'type',
      'streamId',
      'frameId',
      'sourceTimeMs',
      'width',
      'height',
      'corners',
    ]) ||
    value.protocolVersion !== 2 ||
    value.type !== 'frame' ||
    value.streamId !== streamId ||
    !integerIn(value.frameId, 1, Number.MAX_SAFE_INTEGER) ||
    value.frameId <= lastId ||
    !numberIn(value.sourceTimeMs, 0, 1e12) ||
    value.sourceTimeMs < lastTime ||
    !integerIn(value.width, 32, 8192) ||
    !integerIn(value.height, 32, 8192) ||
    value.width * value.height > 16_000_000 ||
    !validCorners(value.corners)
  )
    throw new Error('Invalid frame.');
  const jpeg = bytes.subarray(length + 4);
  if (
    jpeg.length > MEDIA_LIMITS.jpegBytes ||
    !jpegDimensions(jpeg, value.width, value.height)
  )
    throw new Error('Invalid frame.');
  return {
    protocolVersion: 2,
    type: 'frame',
    streamId,
    frameId: value.frameId,
    sourceTimeMs: value.sourceTimeMs,
    width: value.width,
    height: value.height,
    corners: value.corners,
    jpeg,
  };
}
/** Bounded marker probe only. Python independently verifies/decodes the image. */
export function jpegDimensions(
  jpeg: Buffer,
  width: number,
  height: number,
): boolean {
  if (
    jpeg.length < 4 ||
    jpeg[0] !== 255 ||
    jpeg[1] !== 216 ||
    jpeg.at(-2) !== 255 ||
    jpeg.at(-1) !== 217
  )
    return false;
  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    if (jpeg[offset++] !== 255) return false;
    while (jpeg[offset] === 255) offset++;
    const marker = jpeg[offset++];
    if (marker === 218 || marker === 217 || marker === undefined) return false;
    const size = jpeg.readUInt16BE(offset);
    if (size < 2 || offset + size > jpeg.length) return false;
    if (marker === 192 || marker === 194)
      return (
        size >= 8 &&
        jpeg[offset + 2] === 8 &&
        jpeg.readUInt16BE(offset + 3) === height &&
        jpeg.readUInt16BE(offset + 5) === width
      );
    offset += size;
  }
  return false;
}
export function validMeasurements(
  value: unknown,
  frame: Pick<MediaFrame, 'width' | 'height' | 'corners'>,
): value is Record<string, unknown> {
  if (
    !record(value, [
      'source_width',
      'source_height',
      'corners',
      'rectified_width',
      'rectified_height',
      'quality',
      'people',
      'person_box_overlap_fraction',
      'visibility',
      'tracking',
      'automatic_capture_eligible',
    ]) ||
    value.source_width !== frame.width ||
    value.source_height !== frame.height ||
    JSON.stringify(value.corners) !== JSON.stringify(frame.corners) ||
    !integerIn(value.rectified_width, 32, 960) ||
    !integerIn(value.rectified_height, 32, 1600) ||
    value.tracking !== 'unverified' ||
    value.automatic_capture_eligible !== false
  )
    return false;
  const quality = value.quality;
  if (
    !record(quality, [
      'sharpness',
      'brightness',
      'dark_fraction',
      'highlight_fraction',
      'ink_density',
      'focus_uncertain',
      'concerns',
    ]) ||
    !numberIn(quality.sharpness, 0, 1e12) ||
    !numberIn(quality.brightness, 0, 255) ||
    !numberIn(quality.dark_fraction, 0, 1) ||
    !numberIn(quality.highlight_fraction, 0, 1) ||
    !numberIn(quality.ink_density, 0, 1) ||
    typeof quality.focus_uncertain !== 'boolean' ||
    !Array.isArray(quality.concerns) ||
    quality.concerns.length > 4 ||
    !quality.concerns.every(
      (v: unknown) =>
        typeof v === 'string' &&
        [
          'too_dark',
          'possible_blur',
          'clipped_and_textureless',
          'focus_unknown',
        ].includes(v),
    )
  )
    return false;
  const people = value.people;
  if (
    !record(people, ['status', 'boxes', 'inference_ms', 'reason']) ||
    !Array.isArray(people.boxes) ||
    people.boxes.length > 100
  )
    return false;
  if (
    !people.boxes.every(
      (person: unknown) =>
        record(person, ['box', 'confidence']) &&
        Array.isArray(person.box) &&
        person.box.length === 4 &&
        person.box.every((v: unknown) => numberIn(v, 0, 1)) &&
        person.box[0] < person.box[2] &&
        person.box[1] < person.box[3] &&
        numberIn(person.confidence, 0, 1),
    )
  )
    return false;
  if (people.status === 'unavailable')
    return (
      people.boxes.length === 0 &&
      people.inference_ms === null &&
      [
        'model_missing',
        'model_invalid',
        'inference_failed',
        'detector_disabled',
      ].includes(people.reason as string) &&
      value.person_box_overlap_fraction === null &&
      value.visibility === 'unknown'
    );
  return (
    people.status === 'available' &&
    people.reason === null &&
    numberIn(people.inference_ms, 0, MEDIA_LIMITS.jobMs) &&
    numberIn(value.person_box_overlap_fraction, 0, 1) &&
    value.visibility ===
      (value.person_box_overlap_fraction > 0
        ? 'detected_obstruction'
        : 'no_detected_obstruction')
  );
}
export function encodeMediaResult(
  frame: MediaFrame,
  result: MediaResult,
): Buffer {
  const header = Buffer.from(
    JSON.stringify({
      protocolVersion: 2,
      type: 'result',
      streamId: frame.streamId,
      frameId: frame.frameId,
      sourceTimeMs: frame.sourceTimeMs,
      rectifiedBytes: result.rectified.length,
      enhancedBytes: result.enhanced.length,
      measurements: result.measurements,
    }),
  );
  if (header.length > MEDIA_LIMITS.resultHeaderBytes)
    throw new Error('Invalid result.');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);
  return Buffer.concat([prefix, header, result.rectified, result.enhanced]);
}
