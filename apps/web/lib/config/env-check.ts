/**
 * Checks the server's environment once at startup (see instrumentation.ts) so a missing or
 * malformed value stops the deploy with a clear message, instead of failing on a customer's
 * first request. Pure function: pass in any env-like object.
 */

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

const BILLING_VARS = ['DODO_PAYMENTS_API_KEY', 'DODO_PAYMENTS_WEBHOOK_KEY', 'DODO_PRODUCT_PRO', 'DODO_PRODUCT_AGENCY'] as const;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBase64Key32(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) return false;
  try {
    return Buffer.from(value.trim(), 'base64').length === 32;
  } catch {
    return false;
  }
}

export function checkEnv(env: Record<string, string | undefined>): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = (name: string): string => (env[name] ?? '').trim();

  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (get(name) === '') errors.push(`${name} is not set.`);
  }
  if (get('NEXT_PUBLIC_SUPABASE_URL') !== '' && !isHttpUrl(get('NEXT_PUBLIC_SUPABASE_URL'))) errors.push('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');

  if (get('NEXT_PUBLIC_SITE_URL') === '') errors.push('NEXT_PUBLIC_SITE_URL is not set (magic links and billing return URLs need it).');
  else if (!isHttpUrl(get('NEXT_PUBLIC_SITE_URL'))) errors.push('NEXT_PUBLIC_SITE_URL is not a valid URL.');

  // Billing is optional, but a half-configured setup fails at checkout time, so refuse it up front.
  const setBilling = BILLING_VARS.filter((name) => get(name) !== '');
  if (setBilling.length > 0 && setBilling.length < BILLING_VARS.length) {
    const missing = BILLING_VARS.filter((name) => get(name) === '');
    errors.push(`Billing is half configured. Also set: ${missing.join(', ')} (or remove the others to disable billing).`);
  }
  const mode = get('DODO_PAYMENTS_ENVIRONMENT');
  if (mode !== '' && mode !== 'test_mode' && mode !== 'live_mode') errors.push('DODO_PAYMENTS_ENVIRONMENT must be "test_mode" or "live_mode".');
  if (mode === 'live_mode') warnings.push('DODO_PAYMENTS_ENVIRONMENT is live_mode: real payments are enabled.');

  const enc = get('TURNSTILE_ENC_KEY');
  if (enc === '') warnings.push('TURNSTILE_ENC_KEY is not set: forms cannot save a Turnstile secret until it is (openssl rand -base64 32).');
  else if (!isBase64Key32(enc)) errors.push('TURNSTILE_ENC_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32).');

  return { errors, warnings };
}
