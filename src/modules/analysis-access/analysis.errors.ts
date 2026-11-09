import { HttpException } from '@nestjs/common';

export class AnalysisBusyException extends HttpException {
  constructor() {
    super('Analysis connection capacity reached.', 409);
  }
}

export class VisionUnavailableException extends HttpException {
  constructor() {
    super('Vision processing is unavailable.', 503);
  }
}

export class MediaValidationError extends Error {
  constructor() {
    super('Invalid frame.');
  }
}

export const ANALYSIS_ERRORS = {
  UNAUTHENTICATED: 'Authentication required.',
  FORBIDDEN: 'Access denied.',
  VALIDATION_ERROR: 'Invalid request.',
  ANALYSIS_BUSY: 'Analysis connection capacity reached.',
  STALE_CANDIDATE: 'Candidate is no longer available.',
  VISION_UNAVAILABLE: 'Vision processing is unavailable.',
  SERVICE_UNAVAILABLE: 'Service unavailable.',
} as const;
export type AnalysisErrorCode = keyof typeof ANALYSIS_ERRORS;
