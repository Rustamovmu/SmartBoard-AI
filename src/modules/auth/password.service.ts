import { HttpException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash: string;
  private active = 0;
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  } as const;

  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(32), this.options);
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2)
      throw new HttpException('Authentication capacity reached.', 429);
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
    }
  }
  hash(password: string) {
    return this.bounded(() => argon2.hash(password, this.options));
  }
  verify(password: string, hash?: string) {
    return this.bounded(async () => {
      const valid = await argon2.verify(hash ?? this.dummyHash, password);
      return !!hash && valid;
    });
  }
}
