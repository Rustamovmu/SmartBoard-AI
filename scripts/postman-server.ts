import { createPostmanTestHost } from './lib/postman-host';

async function main() {
  const host = await createPostmanTestHost();
  console.log(
    JSON.stringify({
      baseUrl: host.baseUrl,
      database: host.database,
      testRunId: host.testRunId,
    }),
  );
  const timer = setTimeout(stop, 15 * 60_000);
  function stop() {
    clearTimeout(timer);
    void host.close().catch(() => {
      console.error('Guarded Postman cleanup failed.');
      process.exitCode = 1;
    });
  }
  // Keep handlers while async cleanup runs, including duplicate npm/PTY signals.
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
void main().catch(() => {
  console.error(
    'Postman test host failed. Verify dedicated MONGODB_TEST_URI (database path omitted), test permissions, and network access.',
  );
  process.exitCode = 1;
});
