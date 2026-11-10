import { createBrowserClient } from '@supabase/ssr';
import { assertSupabaseEnv, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config/env';

/** Browser client. Subject to Row Level Security with the signed-in user's JWT. */
export function createClient() {
  assertSupabaseEnv();
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
