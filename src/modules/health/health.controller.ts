import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return this.health.getLiveness();
  }

  @Get('ready')
  @HttpCode(HttpStatus.SERVICE_UNAVAILABLE)
  @Header('Cache-Control', 'no-store')
  ready() {
    return this.health.getReadiness();
  }
}
