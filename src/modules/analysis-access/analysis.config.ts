import { Injectable } from '@nestjs/common';

export function parseAnalysisEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.ANALYSIS_TRANSPORT_ENABLED ?? 'false';
  if (value !== 'true' && value !== 'false')
    throw new Error('ANALYSIS_TRANSPORT_ENABLED must be true or false.');
  return value === 'true';
}

@Injectable()
export class AnalysisConfig {
  readonly enabled = parseAnalysisEnabled(process.env);
}
