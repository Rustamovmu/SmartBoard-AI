import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MembersService } from '../members/members.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import {
  AuthTransportService,
  type AuthRequest,
} from './auth-transport.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { LoginDto, RefreshDto, SignupDto } from './dto/auth.dto';
import { AuthEntryGuard } from './guards/auth-entry.guard';
import {
  CurrentAccountGuard,
  type CurrentAccountRequest,
} from './guards/current-account.guard';

@Controller('auth')
@UseGuards(AuthEntryGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AuthSessionService,
    private readonly transport: AuthTransportService,
    private readonly members: MembersService,
    private readonly limits: AuthRateLimitService,
  ) {}

  @Get('csrf')
  csrf(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.transport.issueCsrf(request, response);
  }

  @Post('signup')
  async signup(
    @Body() input: SignupDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const grant = await this.auth.signup(input, request.authTransport);
    return this.transport.respond(
      grant,
      request.authTransport,
      response,
      this.members.publicMember(grant.user),
    );
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.consume('login:account', input.email, 5);
    const grant = await this.auth.login(input, request.authTransport);
    return this.transport.respond(
      grant,
      request.authTransport,
      response,
      this.members.publicMember(grant.user),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() input: RefreshDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const credential = this.transport.refreshCredential(request, input);
    if (!credential) throw new UnauthorizedException();
    const grant = await this.sessions.rotate(credential, request.authTransport);
    return this.transport.respond(
      grant,
      request.authTransport,
      response,
      this.members.publicMember(grant.user),
    );
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Body() input: RefreshDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.logout(
      this.transport.refreshCredential(request, input),
      request.authTransport,
    );
    if (request.authTransport === 'browser') this.transport.clear(response);
    return { success: true };
  }

  @Get('me')
  @UseGuards(CurrentAccountGuard)
  me(@Req() request: CurrentAccountRequest) {
    return { user: this.members.publicMember(request.account.user) };
  }
}
