import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  Kind,
  parse,
  visit,
  type FragmentDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
/** Public mode is a separate, credential-free boundary; never infer access from operation names or aliases. */
export function assertPublicHelpQuery(query: unknown) {
  if (typeof query !== 'string' || Buffer.byteLength(query, 'utf8') > 8192)
    throw new BadRequestException();
  let document;
  try {
    document = parse(query, { maxTokens: 2000 });
  } catch {
    throw new BadRequestException();
  }
  const operations = document.definitions.filter(
    (d) => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (
    operations.length !== 1 ||
    operations[0].operation !== 'query' ||
    document.definitions.length > 6
  )
    throw new UnauthorizedException();
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      if (fragments.has(definition.name.value)) throw new BadRequestException();
      fragments.set(definition.name.value, definition);
    } else if (definition.kind !== Kind.OPERATION_DEFINITION)
      throw new BadRequestException();
  }
  let fields = 0;
  visit(document, {
    Field(node) {
      fields++;
      if (node.name.value.startsWith('__') && node.name.value !== '__typename')
        throw new UnauthorizedException();
    },
  });
  if (fields > 80) throw new BadRequestException();
  let roots = 0;
  const walk = (
    selection: SelectionSetNode,
    stack: Set<string>,
    depth: number,
  ) => {
    if (depth > 6) throw new BadRequestException();
    for (const node of selection.selections) {
      if (node.kind === Kind.FIELD) {
        if (
          ![
            'helpEntries',
            'helpEntry',
            'communityPosts',
            'communityPost',
            'communityComments',
          ].includes(node.name.value) ||
          ++roots > 5
        )
          throw new UnauthorizedException();
      } else if (node.kind === Kind.INLINE_FRAGMENT)
        walk(node.selectionSet, stack, depth + 1);
      else {
        const fragment = fragments.get(node.name.value);
        if (!fragment || stack.has(node.name.value))
          throw new BadRequestException();
        walk(
          fragment.selectionSet,
          new Set([...stack, node.name.value]),
          depth + 1,
        );
      }
    }
  };
  walk(operations[0].selectionSet, new Set(), 0);
  if (!roots) throw new BadRequestException();
}
