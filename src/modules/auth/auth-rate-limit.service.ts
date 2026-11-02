import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AUTH_ATTEMPT_MODEL, AuthAttempt } from './schemas/auth-attempt.schema';
import { digest } from './token.service';

@Injectable()
export class AuthRateLimitService {
  constructor(
    @InjectModel(AUTH_ATTEMPT_MODEL)
    private readonly attempts: Model<AuthAttempt>,
  ) {}

  async consume(scope: string, identity: string, maximum: number, cost = 1) {
    if (!Number.isInteger(cost) || cost < 1 || cost > maximum)
      throw new BadRequestException();
    const bucket = Math.floor(Date.now() / 60_000);
    const id = digest(`${scope}:${identity}:${bucket}`);
    try {
      await this.attempts
        .findOneAndUpdate(
          { _id: id, count: { $lte: maximum - cost } },
          {
            $inc: { count: cost },
            $setOnInsert: { expiresAt: new Date((bucket + 1) * 60_000) },
          },
          { upsert: true, runValidators: true },
        )
        .exec();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new HttpException('Too many requests.', 429);
      }
      throw error;
    }
  }
}
