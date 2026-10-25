import { randomUUID } from 'node:crypto';
import { TokenService, digest, matchesHash } from './token.service';

describe('opaque credentials', () => {
  const tokens = new TokenService();
  it('uses separate access/refresh formats and unguessable secrets', () => {
    const id = randomUUID();
    const family = tokens.secret();
    const access = tokens.access(id);
    const refresh = tokens.refresh(id, family);
    expect(tokens.parseAccess(access).id).toBe(id);
    expect(tokens.parseRefresh(refresh)).toEqual({ id, familySecret: family });
    expect(tokens.access(id)).not.toBe(access);
    expect(tokens.refresh(id, family)).not.toBe(refresh);
    expect(() => tokens.parseAccess(refresh)).toThrow();
    expect(() => tokens.parseRefresh(access)).toThrow();
    expect(matchesHash(refresh, digest(refresh))).toBe(true);
    expect(matchesHash(access, digest(refresh))).toBe(false);
  });
  it.each([
    '',
    'not-a-token',
    'sb_a.bad.secret',
    'Bearer token',
    'sb_r.path/../../file',
  ])('rejects malformed credentials %s', (value) => {
    expect(() => tokens.parseAccess(value)).toThrow();
    expect(() => tokens.parseRefresh(value)).toThrow();
  });
});
