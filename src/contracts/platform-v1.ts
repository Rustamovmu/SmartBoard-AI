/** Framework-independent handoff contract. Routes may still be unimplemented. */
export const PROTOCOL_VERSION = 1 as const;

export const PLATFORM_ROUTES = [
  { method: 'POST', path: '/auth/signup' },
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/refresh' },
  { method: 'POST', path: '/auth/logout' },
  { method: 'GET', path: '/auth/me' },
  { method: 'GET', path: '/auth/csrf' },
  { method: 'POST', path: '/graphql' },
  { method: 'POST', path: '/analysis/access' },
  { method: 'WSS', path: '/ws/analyze' },
  { method: 'WSS', path: '/ws/control' },
  { method: 'GET', path: '/health/live' },
  { method: 'GET', path: '/health/ready' },
] as const;

export const PLATFORM_COLLECTIONS = [
  'users',
  'authSessions',
  'authAttempts',
  'devices',
  'pairingRequests',
  'helpEntries',
  'communityPosts',
  'communityComments',
  'reports',
  'auditEvents',
  'platformSettings',
] as const;

export const FORBIDDEN_COLLECTIONS = [
  'lectures',
  'recordings',
  'captures',
  'thumbnails',
  'baselines',
  'ocr',
  'privateNotes',
  'media',
] as const;

/** Representative paths for negative endpoint regression tests, not a router. */
export const FORBIDDEN_HTTP_PATHS = [
  '/uploads/videos',
  '/uploads/example.jpg',
  '/lectures',
  '/lectures/example',
  '/recordings',
  '/captures',
  '/media',
  '/exports',
  '/lecture-sync',
  '/admin/recordings',
  '/admin/devices/example/wipe',
] as const;

export const SERVER_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'DEVICE_REVOKED',
  'ANALYSIS_BUSY',
  'VISION_UNAVAILABLE',
  'CONFLICT',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'REQUEST_REJECTED',
  'INTERNAL_ERROR',
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export interface HttpErrorResponse {
  statusCode: number;
  code: ServerErrorCode;
  message: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Required limits for the future analysis implementation; not active services. */
export const ANALYSIS_LIMITS = {
  maxJpegBytes: 2_000_000,
  maxDecodedPixels: 16_000_000,
  maxInFlightFramesPerStream: 1,
  inactivityTimeoutMs: 30_000,
  targetSamplesPerSecond: 5,
  stabilityMs: 2_000,
  captureIntervalMs: 3_000,
} as const;
