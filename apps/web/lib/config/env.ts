// NEXT_PUBLIC_* values must be referenced as literal `process.env.NEXT_PUBLIC_X`
// expressions so Next can inline them into the browser bundle.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
export const INGEST_URL = (process.env.NEXT_PUBLIC_INGEST_URL ?? 'https://api.auklet.dev').replace(/\/+$/, '');

export function assertSupabaseEnv(): void {
  if (SUPABASE_URL === '' || SUPABASE_ANON_KEY === '') {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.');
  }
}

export function formEndpoint(formId: string): string {
  return `${INGEST_URL}/v1/f/${formId}`;
}
