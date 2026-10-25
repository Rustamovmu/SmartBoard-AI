import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthTransportService } from './auth-transport.service';
import { TokenService } from './token.service';

describe('authentication transport boundary', () => {
  const transport = new AuthTransportService(
    { browserOrigins: ['https://localhost:3000'] },
    new TokenService(),
  );
  const csrf = 'A'.repeat(43);
  const request = (headers: Record<string, string>) =>
    ({ method: 'POST', headers, is: () => true }) as unknown as Request;
  const browser = {
    'x-smartbord-client': 'browser',
    origin: 'https://localhost:3000',
    cookie: `__Host-sb_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };

  it('accepts the exact browser origin and matching random-format CSRF cookie/header', () => {
    expect(transport.assertRequest(request(browser))).toBe('browser');
  });
  it.each(['é'.repeat(43), 'X'.repeat(42), 'X'.repeat(44), 'wrong-token'])(
    'rejects an invalid CSRF header as forbidden rather than an internal error',
    (value) =>
      expect(() =>
        transport.assertRequest(request({ ...browser, 'x-csrf-token': value })),
      ).toThrow(ForbiddenException),
  );
  it('rejects duplicate CSRF cookies and a browser bearer credential', () => {
    expect(() =>
      transport.assertRequest(
        request({ ...browser, cookie: `${browser.cookie}; ${browser.cookie}` }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      transport.assertRequest(
        request({ ...browser, authorization: 'Bearer synthetic-token' }),
      ),
    ).toThrow(ForbiddenException);
  });
  it('rejects native requests carrying browser origin/cookies', () => {
    expect(() =>
      transport.assertRequest(
        request({
          'x-smartbord-client': 'native',
          origin: 'https://localhost:3000',
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      transport.assertRequest(
        request({ 'x-smartbord-client': 'native', cookie: 'synthetic=value' }),
      ),
    ).toThrow(ForbiddenException);
  });
});
