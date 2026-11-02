import { GraphQLError, Kind, type ValidationRule } from 'graphql';

/** Bound AST work even when aliases/fragments are used; schema itself has no recursive fields. */
export const documentLimits: ValidationRule = (context) => {
  let fields = 0;
  let depth = 0;
  let operations = 0;
  let roots = 0;
  return {
    OperationDefinition() {
      operations++;
    },
    Field() {
      fields++;
      const parent = context.getParentType();
      if (
        parent === context.getSchema().getQueryType() ||
        parent === context.getSchema().getMutationType()
      )
        roots++;
    },
    SelectionSet: {
      enter() {
        depth++;
        if (depth > 6)
          context.reportError(
            new GraphQLError('Invalid request.', {
              extensions: { code: 'VALIDATION_ERROR' },
            }),
          );
      },
      leave() {
        depth--;
      },
    },
    Document: {
      leave(node) {
        if (
          operations !== 1 ||
          fields > 80 ||
          roots > 5 ||
          node.definitions.length > 6 ||
          node.definitions.some(
            (d) =>
              d.kind !== Kind.OPERATION_DEFINITION &&
              d.kind !== Kind.FRAGMENT_DEFINITION,
          )
        ) {
          context.reportError(
            new GraphQLError('Invalid request.', {
              extensions: { code: 'VALIDATION_ERROR' },
            }),
          );
        }
      },
    },
  };
};
