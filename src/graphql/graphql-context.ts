import type { Response } from 'express';
import type { CurrentAccountRequest } from '../modules/auth/guards/current-account.guard';

export interface PlatformGraphqlContext {
  req: CurrentAccountRequest;
  res: Response;
  credential: string;
}
