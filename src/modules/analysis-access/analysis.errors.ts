import { HttpException } from '@nestjs/common';

export class AnalysisBusyException extends HttpException {
  constructor() {
    super('Analysis connection capacity reached.', 409);
  }
}

export const ANALYSIS_ERRORS = {
  UNAUTHENTICATED: 'Authentication required.',
  FORBIDDEN: 'Access denied.',
  VALIDATION_ERROR: 'Invalid request.',
  ANALYSIS_BUSY: 'Analysis connection capacity reached.',
  VISION_UNAVAILABLE: 'Vision processing is unavailable.',
  SERVICE_UNAVAILABLE: 'Service unavailable.',
} as const;
export type AnalysisErrorCode = keyof typeof ANALYSIS_ERRORS;
