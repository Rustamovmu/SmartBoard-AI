import { assertPublicHelpQuery } from './public-help-policy';
describe('credential-free published help boundary', () => {
  it.each([
    'query { helpEntries(input:{kind:FAQ}) { items { id title } total } }',
    'query { alias: helpEntry(id:"x") { id __typename } }',
    'query { ...R } fragment R on Query { helpEntry(id:"x") { id } }',
    'query { c: communityPosts(input:{}) { total } }',
    'query { ...C } fragment C on Query { communityPost(id:"x") { id } }',
    'query { ... on Query { helpEntry(id:"x") { id } } }',
  ])('accepts only public roots: %s', (query) =>
    expect(() => assertPublicHelpQuery(query)).not.toThrow(),
  );
  it.each([
    'query { communityPosts(input:{}) { total } myCommunityPosts(input:{}) @skip(if:true) { total } }',
    'query { ...C } fragment C on Query { adminCommunityPosts(input:{}) { total } }',
    'query { alias: currentAccount { id } }',
    'query { helpEntry(id:"x") { id } currentAccount @skip(if:true) { id } }',
    'query { ...R } fragment R on Query { adminAccounts(input:{}) { total } }',
    'mutation { adminUpdateHelpEntry(input:{}) { id } }',
    'query A { helpEntry(id:"x") { id } } query B { currentAccount { id } }',
    'query { __schema { types { name } } }',
    'query { ...R } fragment R on Query { ...R }',
    'query { ...Missing }',
    '{',
    ' '.repeat(8193),
  ])('rejects protected, malformed or unbounded roots: %s', (query) =>
    expect(() => assertPublicHelpQuery(query)).toThrow(),
  );
});
