import { Body, Controller, Header, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth-transport.service';
import { AnalysisAccessService } from './analysis-access.service';

@Controller('analysis')
export class AnalysisAccessController {
  constructor(private readonly access: AnalysisAccessService) {}

  @Post('access')
  @Header('Cache-Control', 'no-store')
  issue(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.access.issue(request, body);
  }
}
