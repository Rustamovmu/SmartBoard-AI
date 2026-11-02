import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { formatGraphqlError, safeGraphqlError } from './graphql-errors';

describe('GraphQL error redaction', () => {
  it.each([
    [new BadRequestException('private-marker'), 'VALIDATION_ERROR'],
    [new ForbiddenException('private-marker'), 'FORBIDDEN'],
    [new ConflictException('private-marker'), 'CONFLICT'],
    [new Error('private-marker'), 'INTERNAL_ERROR'],
  ])('maps known exceptions and hides arbitrary messages', (error, code) => {
    const wrapped = new GraphQLError('private-marker', {
      originalError: error,
      extensions: { stacktrace: ['private-marker'] },
    });
    const result = formatGraphqlError(wrapped.toJSON(), wrapped);
    expect(result.extensions).toEqual({ code });
    expect(JSON.stringify(result)).not.toContain('private-marker');
    expect(Object.keys(result).sort()).toEqual(['extensions', 'message']);
  });
  it('sanitizes parse/validation errors and untrusted error extension codes', () => {
    for (const code of [
      'GRAPHQL_PARSE_FAILED',
      'GRAPHQL_VALIDATION_FAILED',
      'BAD_USER_INPUT',
      'BAD_REQUEST',
    ]) {
      const error = new GraphQLError('private-marker', {
        extensions: { code },
      });
      expect(safeGraphqlError(error).extensions.code).toBe('VALIDATION_ERROR');
    }
    expect(
      safeGraphqlError(
        new GraphQLError('private-marker', {
          extensions: { code: 'private-marker' },
        }),
      ).extensions.code,
    ).toBe('INTERNAL_ERROR');
  });
});
