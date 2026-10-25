import { Injectable } from '@nestjs/common';
import { parseEnvironment } from './environment';

@Injectable()
export class AppConfig {
  readonly environment = parseEnvironment(process.env);
}
