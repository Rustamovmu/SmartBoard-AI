import { isIP } from 'node:net';

export interface Environment {
  port: number;
  host: string;
  nodeEnv: 'development' | 'test' | 'production';
}

/** Validate without printing supplied values, which may contain credentials. */
export function parseEnvironment(env: NodeJS.ProcessEnv): Environment {
  const port = env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const host = env.HOST ?? '127.0.0.1';
  if (host !== 'localhost' && isIP(host) === 0) {
    throw new Error('HOST must be an IP address or localhost.');
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  return {
    port: Number(port),
    host,
    nodeEnv: nodeEnv as Environment['nodeEnv'],
  };
}
