import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FORBIDDEN_COLLECTIONS,
  PLATFORM_COLLECTIONS,
  PLATFORM_ROUTES,
  SERVER_ERROR_CODES,
} from './platform-v1';

describe('cross-project V1 contract', () => {
  it.each(['Backend_plan.md', 'Frontend_plan.md'])(
    'keeps every shared route in %s',
    (file) => {
      const plan = readFileSync(resolve('docs', file), 'utf8');
      for (const route of PLATFORM_ROUTES) expect(plan).toContain(route.path);
      for (const code of SERVER_ERROR_CODES.slice(0, 6)) {
        expect(plan).toContain(code);
      }
      expect(plan).toContain('{ items, page, pageSize, total }');
    },
  );

  it('keeps MongoDB collections restricted to the platform plan', () => {
    const plan = readFileSync(resolve('docs/Backend_plan.md'), 'utf8');
    for (const collection of PLATFORM_COLLECTIONS) {
      expect(plan).toContain(collection);
      expect(FORBIDDEN_COLLECTIONS).not.toContain(collection);
    }
  });
});
