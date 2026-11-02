import { buildSchema, parse, validate } from 'graphql';
import { documentLimits } from './document-limits';

describe('bounded GraphQL documents', () => {
  const schema = buildSchema(
    'type Account { id: ID!, child: Account } type Query { currentAccount: Account! }',
  );
  const errors = (query: string) =>
    validate(schema, parse(query), [documentLimits]);
  it('accepts one bounded operation including reusable fragments', () => {
    expect(
      errors('query { currentAccount { ...A } } fragment A on Account { id }'),
    ).toEqual([]);
  });
  it('rejects multiple operations, excessive root aliases, field count and depth', () => {
    for (const query of [
      'query A {currentAccount{id}} query B {currentAccount{id}}',
      `{${Array.from({ length: 6 }, (_v, i) => `a${i}:currentAccount{id}`).join(' ')}}`,
      `{currentAccount{${Array.from({ length: 81 }, (_v, i) => `a${i}:id`).join(' ')}}}`,
      '{currentAccount{child{child{child{child{child{child{id}}}}}}}}',
    ])
      expect(errors(query).length).toBeGreaterThan(0);
  });
});
