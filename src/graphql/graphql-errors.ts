import { HttpException } from '@nestjs/common';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';

const errors: Record<string, string> = {
  VALIDATION_ERROR: 'Invalid request.',
  UNAUTHENTICATED: 'Authentication required.',
  FORBIDDEN: 'Access denied.',
  NOT_FOUND: 'Account not found.',
  CONFLICT: 'Account change conflicts with platform policy.',
  RATE_LIMITED: 'Too many requests.',
  SERVICE_UNAVAILABLE: 'Service unavailable.',
  INTERNAL_ERROR: 'Internal server error.',
};
const statuses: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Never expose GraphQL suggestions, input values, exception text or stack traces. */
export function safeGraphqlError(error: unknown): GraphQLError {
  let original = error;
  for (
    let i = 0;
    i < 4 && original instanceof GraphQLError && original.originalError;
    i++
  )
    original = original.originalError;
  let code = 'INTERNAL_ERROR';
  if (original instanceof HttpException)
    code = statuses[original.getStatus()] ?? code;
  else if (original instanceof GraphQLError) {
    const candidate = original.extensions.code;
    if (typeof candidate === 'string' && Object.hasOwn(errors, candidate))
      code = candidate;
    else if (
      [
        'GRAPHQL_PARSE_FAILED',
        'GRAPHQL_VALIDATION_FAILED',
        'BAD_USER_INPUT',
        'BAD_REQUEST',
        'OPERATION_RESOLUTION_FAILURE',
      ].includes(String(candidate))
    )
      code = 'VALIDATION_ERROR';
  }
  return new GraphQLError(errors[code], { extensions: { code } });
}

export function formatGraphqlError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const safe = safeGraphqlError(error);
  // Apollo's variable validation code is sometimes attached to its formatted copy.
  if (
    safe.extensions.code === 'INTERNAL_ERROR' &&
    [
      'GRAPHQL_PARSE_FAILED',
      'GRAPHQL_VALIDATION_FAILED',
      'BAD_USER_INPUT',
      'BAD_REQUEST',
      'OPERATION_RESOLUTION_FAILURE',
    ].includes(String(formatted.extensions?.code))
  ) {
    return {
      message: errors.VALIDATION_ERROR,
      extensions: { code: 'VALIDATION_ERROR' },
    };
  }
  return { message: safe.message, extensions: safe.extensions };
}
