import { ConflictException } from '@nestjs/common';

/** Only a confirmed username-index collision may produce the public hint. */
export class UsernameTakenException extends ConflictException {}
