import { parseEnvironment } from './environment';

describe('environment configuration', () => {
  it('preserves port 3000 and defaults to loopback', () => {
    expect(parseEnvironment({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      nodeEnv: 'development',
    });
  });

  it('accepts explicit deployment configuration', () => {
    expect(
      parseEnvironment({ PORT: '4000', HOST: '::1', NODE_ENV: 'production' }),
    ).toEqual({ port: 4000, host: '::1', nodeEnv: 'production' });
  });

  it.each(['', '0', '-1', '65536', '3.5', '3000junk', ' 3000', 'Infinity'])(
    'rejects invalid PORT %p',
    (PORT) => expect(() => parseEnvironment({ PORT })).toThrow('PORT must'),
  );

  it.each(['', 'https://localhost', '127.0.0.1/path'])(
    'rejects invalid HOST %p',
    (HOST) => expect(() => parseEnvironment({ HOST })).toThrow('HOST must'),
  );

  it('does not disclose invalid environment values', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'synthetic-secret' })).toThrow(
      'NODE_ENV must be development, test, or production.',
    );
  });
});
