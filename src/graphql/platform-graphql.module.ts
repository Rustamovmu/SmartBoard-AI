import {
  Module,
  UnauthorizedException,
  MethodNotAllowedException,
  HttpException,
} from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { Response } from 'express';
import { GraphQLError } from 'graphql';
import { AuthModule } from '../modules/auth/auth.module';
import { AuthTransportService } from '../modules/auth/auth-transport.service';
import { AuthSessionService } from '../modules/auth/auth-session.service';
import { AuthSchemaService } from '../modules/auth/auth-schema.service';
import { AuthRateLimitService } from '../modules/auth/auth-rate-limit.service';
import type { CurrentAccountRequest } from '../modules/auth/guards/current-account.guard';
import { formatGraphqlError, safeGraphqlError } from './graphql-errors';
import { assertPublicHelpQuery } from './public-help-policy';
import { documentLimits } from './document-limits';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [AuthModule],
      inject: [
        AuthTransportService,
        AuthSessionService,
        AuthSchemaService,
        AuthRateLimitService,
      ],
      useFactory: (
        transport: AuthTransportService,
        sessions: AuthSessionService,
        schema: AuthSchemaService,
        limits: AuthRateLimitService,
      ): ApolloDriverConfig => ({
        autoSchemaFile: true,
        sortSchema: true,
        path: '/graphql',
        introspection: false,
        playground: false,
        csrfPrevention: true,
        allowBatchedHttpRequests: false,
        persistedQueries: false,
        documentStore: null,
        includeStacktraceInErrorResponses: false,
        autoTransformHttpErrors: false,
        validationRules: [documentLimits],
        formatError: formatGraphqlError,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        context: async ({
          req,
          res,
        }: {
          req: CurrentAccountRequest;
          res: Response;
        }) => {
          res.setHeader('Cache-Control', 'no-store');
          try {
            if (req.method !== 'POST') throw new MethodNotAllowedException();
            if (req.headers['x-smartbord-client'] === 'public') {
              transport.assertPublicRead(req);
              await schema.assertPrepared();
              await limits.consume('graphql:ip', req.ip ?? 'unknown', 60);
              assertPublicHelpQuery(
                (req.body as { query?: unknown } | undefined)?.query,
              );
              return { req, res, publicRead: true };
            }
            req.authTransport = transport.assertRequest(req);
            await schema.assertPrepared();
            await limits.consume('graphql:ip', req.ip ?? 'unknown', 60);
            const credential = transport.accessCredential(req);
            if (!credential) throw new UnauthorizedException();
            req.account = await sessions.authenticate(
              credential,
              req.authTransport,
            );
            await limits.consume('graphql:account', req.account.user._id, 60);
            return { req, res, credential };
          } catch (error) {
            const safe = safeGraphqlError(error);
            throw new GraphQLError(safe.message, {
              extensions: {
                ...safe.extensions,
                http: {
                  status:
                    error instanceof HttpException ? error.getStatus() : 500,
                },
              },
            });
          }
        },
      }),
    }),
  ],
})
export class PlatformGraphqlModule {}
