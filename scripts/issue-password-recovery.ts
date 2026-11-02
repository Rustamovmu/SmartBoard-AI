import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { fstatSync, writeSync } from 'node:fs';
import { isEmail } from 'class-validator';
import { AppModule } from '../src/app.module';
import { PasswordRecoveryService } from '../src/modules/auth/password-recovery.service';

async function main() {
  const email = process.env.RECOVERY_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!email || !isEmail(email) || email.length > 254) throw new Error();
  // Secret output is opt-in and pipe-only, never an ordinary invocation, file,
  // terminal or combined diagnostic stream. npm must be run with --silent.
  if (process.argv.length !== 3 || process.argv[2] !== '--private-output')
    throw new Error();
  const output = fstatSync(1);
  // Node implements child-process "pipe" streams as anonymous socket pairs.
  if (!output.isFIFO() && !output.isSocket()) throw new Error();
  const diagnostic = fstatSync(2);
  if (output.dev === diagnostic.dev && output.ino === diagnostic.ino)
    throw new Error();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const grant = await app.get(PasswordRecoveryService).issue(email);
    const payload = Buffer.from(`${JSON.stringify(grant)}\n`);
    if (writeSync(1, payload) !== payload.length) throw new Error();
    console.error(
      'Recovery proof issued to the private output pipe. No password, role or status was changed.',
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    'Recovery issuance failed. Check the active account, explicit schema setup, --private-output flag and separate private output pipe. If delivery failed, reissue to replace any committed proof.',
  );
  process.exitCode = 1;
});
