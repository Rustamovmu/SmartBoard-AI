import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { CurrentAccountRequest } from './current-account.guard';

/** Must follow CurrentAccountGuard; checks the database-loaded role. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const account = context
      .switchToHttp()
      .getRequest<CurrentAccountRequest>().account;
    if (!account || account.user.role !== 'ADMIN')
      throw new ForbiddenException();
    return true;
  }
}
