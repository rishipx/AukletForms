import { errorMessage, log } from './log';
import { purgeOldData } from './supabase';
import type { Env } from './types';

/**
 * Runs once a day from the cron trigger in wrangler.toml.
 *  - Applies the retention policy (see purge_old_data in the database migrations).
 *  - The same request is database activity, which keeps a free Supabase project from
 *    being paused for inactivity.
 * Throws on failure so the failed run is visible in the Cloudflare dashboard.
 */
export async function runMaintenance(env: Env): Promise<void> {
  try {
    const result = await purgeOldData(env);
    log('info', 'maintenance finished', { result });
  } catch (err) {
    log('error', 'maintenance failed', { error: errorMessage(err) });
    throw err;
  }
}
