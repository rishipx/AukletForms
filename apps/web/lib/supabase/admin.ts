import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '@/lib/config/env';

/**
 * Service-role client: BYPASSES Row Level Security. Server-only (the import above
 * makes the build fail if a client component ever pulls this in). Use it only
 * where no user session exists, such as webhooks, and never with user-supplied filters.
 */
export function createAdminClient() {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!SUPABASE_URL || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  return createSupabaseClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
