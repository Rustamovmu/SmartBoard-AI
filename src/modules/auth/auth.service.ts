import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { AuthTransport } from '../../contracts/auth-v1';
import { MembersService } from '../members/members.service';
import { AuthSessionService } from './auth-session.service';
import { PasswordService } from './password.service';
import type { SignupDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly members: MembersService,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthSessionService,
  ) {}

  async signup(input: SignupDto, transport: AuthTransport) {
    const passwordHash = await this.passwords.hash(input.password);
    return this.connection.transaction(async (transaction) => {
      const user = await this.members.create(
        { email: input.email, name: input.name, passwordHash },
        'USER',
        transaction,
      );
      return this.sessions.create(user, transport, transaction);
    });
  }

  async login(input: LoginDto, transport: AuthTransport) {
    const user = await this.members.findCredentials(input.email);
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
