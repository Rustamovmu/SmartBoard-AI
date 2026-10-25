export function parseAuthOrigins(env: NodeJS.ProcessEnv): string[] {
  const value =
    env.AUTH_BROWSER_ORIGINS ??
    (env.NODE_ENV === 'production' ? '' : 'https://localhost:3000');
  const origins = value.split(',').map((origin) => origin.trim());
  if (
    !value ||
    origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return (
          parsed.protocol !== 'https:' ||
          parsed.origin !== origin ||
          !!parsed.username ||
          !!parsed.password
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('AUTH_BROWSER_ORIGINS must contain exact HTTPS origins.');
  }
  return [...new Set(origins)];
}
