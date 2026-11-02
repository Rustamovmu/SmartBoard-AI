import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { PlatformGraphqlContext } from './graphql-context';

@Injectable()
export class GraphqlAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { req } =
      GqlExecutionContext.create(context).getContext<PlatformGraphqlContext>();
    if (req.account.user.role !== 'ADMIN') throw new ForbiddenException();
    return true;
  }
}
