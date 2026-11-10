/**
 * Runs once when the server starts. A bad environment stops production at boot with a readable
 * message; in development it only warns, so a half-filled .env.local still lets you work.
 * Skipped during `next build`, which legitimately runs without runtime secrets.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs' || process.env['NEXT_PHASE'] === 'phase-production-build') return;

  const { checkEnv } = await import('./lib/config/env-check');
  const { log } = await import('./lib/log');
  const { errors, warnings } = checkEnv(process.env);
  for (const warning of warnings) log('warn', 'environment', { detail: warning });

  if (errors.length === 0) return;
  const text = `Invalid environment:\n - ${errors.join('\n - ')}`;
  if (process.env['NODE_ENV'] === 'production') throw new Error(text);
  log('warn', 'environment', { detail: text });
}
