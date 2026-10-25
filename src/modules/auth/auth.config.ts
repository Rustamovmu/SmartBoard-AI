import { Injectable } from '@nestjs/common';
import { parseAuthOrigins } from '../../config/auth-environment';

@Injectable()
export class AuthConfig {
  readonly browserOrigins = parseAuthOrigins(process.env);
}
