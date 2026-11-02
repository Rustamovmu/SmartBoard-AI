import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { createPostmanTestHost } from './lib/postman-host';

async function main() {
  const host = await createPostmanTestHost();
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const env = { ...process.env };
    // The Postman runner only needs its HTTP fixture credentials, generated in
    // runtime variables. Never hand it database/bootstrap credentials.
    for (const key of Object.keys(env)) {
      if (/^(MONGO|ADMIN_BOOTSTRAP|POSTMAN_API_KEY)/.test(key)) delete env[key];
    }
    const result = await promisify(execFile)(
      process.execPath,
      [
        'node_modules/postman-cli/bin/postman.js',
        'collection',
        'run',
        'postman/SmartBoardAI.postman_collection.json',
        '--env-var',
        `baseUrl=${host.baseUrl}`,
        '--env-var',
        `testRunId=${host.testRunId}`,
        '--no-report-events',
        '--bail',
        'failure',
        '--timeout-request',
        '15000',
      ],
      { env, timeout: 120_000, signal: abort.signal, maxBuffer: 1_048_576 },
    ).catch((error: unknown) => {
      // Report only a known static request name, never raw CLI assertion output:
      // it can contain resolved credentials/cookies or response bodies.
      const stdout =
        typeof error === 'object' &&
        error &&
        'stdout' in error &&
        typeof error.stdout === 'string'
          ? error.stdout
          : '';
      const collection = JSON.parse(
        readFileSync('postman/SmartBoardAI.postman_collection.json', 'utf8'),
      ) as { item: { name: string }[] };
      const reported = collection.item.filter((item) =>
        stdout.includes(item.name),
      );
      const last = reported.at(-1);
      if (last) console.error(`Postman last reported request: ${last.name}`);
      throw new Error('Postman collection did not pass.');
    });
    process.stdout.write(result.stdout);
  } finally {
    await host.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
void main().catch(() => {
  console.error(
    'Postman verification failed; see the collection and auth integration checks.',
  );
  process.exitCode = 1;
});
