import { Injectable } from '@nestjs/common';
import { parseEnvironment } from './environment';
import { parseDatabaseEnvironment } from './database-environment';

@Injectable()
export class AppConfig {
  readonly environment = parseEnvironment(process.env);

  get database() {
    return parseDatabaseEnvironment(process.env, this.environment.nodeEnv);
  }
}
