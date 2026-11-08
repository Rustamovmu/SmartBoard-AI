import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { USERNAME_PATTERN } from '../../contracts/username-v1';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { MembersService } from '../members/members.service';
import { AuthSessionService } from './auth-session.service';
import { PasswordService } from './password.service';
import type { SignupDto, LoginDto } from './dto/auth.dto';
import { AuthRateLimitService } from './auth-rate-limit.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly members: MembersService,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthSessionService,
    private readonly limits: AuthRateLimitService,
  ) {}

  async signup(input: SignupDto, transport: AuthTransport) {
    const passwordHash = await this.passwords.hash(input.password);
    return this.connection.transaction(async (transaction) => {
      const user = await this.members.create(
        {
          email: input.email,
          name: input.name,
          passwordHash,
          username: input.username,
        },
        'USER',
        transaction,
      );
      return this.sessions.create(user, transport, transaction);
    });
  }

  async login(input: LoginDto, transport: AuthTransport) {
    if ((input.email === undefined) === (input.identifier === undefined))
      throw new BadRequestException();
    const identifier = input.identifier ?? input.email!;
    if (
      identifier.includes('@')
        ? !isEmail(identifier)
        : !USERNAME_PATTERN.test(identifier)
    )
      throw new BadRequestException();
    const user = await this.members.findCredentials(identifier);
    // Email and username aliases for the same account cannot multiply its budget.
    await this.limits.consume(
      'login:account',
      user ? `user:${user._id}` : `identifier:${identifier}`,
      5,
    );
    const valid = await this.passwords.verify(
      input.password,
      user?.passwordHash,
    );
    if (!valid || !user || user.status !== 'ACTIVE')
      throw new UnauthorizedException();
    return this.connection.transaction(async (transaction) => {
      const current = await this.members.findCurrent(user._id, transaction);
      if (
        !current ||
        current.status !== 'ACTIVE' ||
        current.authVersion !== user.authVersion
      )
        throw new UnauthorizedException();
      return this.sessions.create(current, transport, transaction);
    });
  }
}
