import { Injectable } from '@nestjs/common';
import { isAbsolute, resolve } from 'node:path';

export function parseAnalysisEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.ANALYSIS_TRANSPORT_ENABLED ?? 'false';
  if (value !== 'true' && value !== 'false')
    throw new Error('ANALYSIS_TRANSPORT_ENABLED must be true or false.');
  return value === 'true';
}

@Injectable()
export class AnalysisConfig {
  readonly enabled = parseAnalysisEnabled(process.env);
  readonly mediaEnabled = (() => {
    const value = process.env.ANALYSIS_MEDIA_ENABLED ?? 'false';
    if (value !== 'true' && value !== 'false')
      throw new Error('ANALYSIS_MEDIA_ENABLED must be true or false.');
    if (value === 'true' && !this.enabled)
      throw new Error('Analysis media requires the transport flag.');
    return value === 'true';
  })();
  readonly projectRoot = process.cwd();
  readonly pythonExecutable = (() => {
    const value =
      process.env.VISION_PYTHON_EXECUTABLE ??
      resolve(this.projectRoot, 'vision/.venv/bin/python');
    if (!isAbsolute(value))
      throw new Error('VISION_PYTHON_EXECUTABLE must be an absolute path.');
    return value;
  })();
}
