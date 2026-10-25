import { parseAuthOrigins } from './auth-environment';

describe('browser authentication origin configuration', () => {
  it('uses an explicit HTTPS development default', () => {
    expect(parseAuthOrigins({})).toEqual(['https://localhost:3000']);
  });
  it.each([
    '*',
    'http://localhost:3000',
    'https://example.test/',
    'https://user:secret@example.test',
    'null',
    'https://example.test/path',
  ])('rejects unsafe origin %s', (value) => {
    expect(() => parseAuthOrigins({ AUTH_BROWSER_ORIGINS: value })).toThrow(
      'exact HTTPS origins',
    );
  });
  it('requires explicit production origins', () => {
    expect(() => parseAuthOrigins({ NODE_ENV: 'production' })).toThrow();
  });
});
