import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function matchesHash(value: string, expected: string) {
  const actual = digest(value);
  return (
    /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

const uuid =
  '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const accessPattern = new RegExp(`^sb_a\\.(${uuid})\\.([A-Za-z0-9_-]{43})$`);
const refreshPattern = new RegExp(
  `^sb_r\\.(${uuid})\\.([A-Za-z0-9_-]{43})\\.([A-Za-z0-9_-]{43})$`,
);

@Injectable()
export class TokenService {
  secret() {
    return randomBytes(32).toString('base64url');
  }
  access(id: string) {
    return `sb_a.${id}.${this.secret()}`;
  }
  refresh(id: string, familySecret: string) {
    return `sb_r.${id}.${familySecret}.${this.secret()}`;
  }

  parseAccess(raw: string) {
    const match = accessPattern.exec(raw);
    if (!match) throw new UnauthorizedException();
    return { id: match[1] };
  }
  parseRefresh(raw: string) {
    const match = refreshPattern.exec(raw);
    if (!match) throw new UnauthorizedException();
    return { id: match[1], familySecret: match[2] };
  }
}
