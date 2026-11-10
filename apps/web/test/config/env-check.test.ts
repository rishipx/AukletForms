import { describe, expect, it } from 'vitest';
import { checkEnv } from '@/lib/config/env-check';

const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  NEXT_PUBLIC_SITE_URL: 'https://app.example.com',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  TURNSTILE_ENC_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
};
const BILLING = { DODO_PAYMENTS_API_KEY: 'k', DODO_PAYMENTS_WEBHOOK_KEY: 'whsec_x', DODO_PRODUCT_PRO: 'pdt_1', DODO_PRODUCT_AGENCY: 'pdt_2' };

describe('startup environment check', () => {
  it('accepts a complete setup with and without billing', () => {
    expect(checkEnv(GOOD)).toEqual({ errors: [], warnings: [] });
    expect(checkEnv({ ...GOOD, ...BILLING, DODO_PAYMENTS_ENVIRONMENT: 'test_mode' }).errors).toEqual([]);
  });

  it('reports every missing required variable', () => {
    expect(checkEnv({}).errors).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL is not set.',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.',
      'SUPABASE_SERVICE_ROLE_KEY is not set.',
      'NEXT_PUBLIC_SITE_URL is not set (magic links and billing return URLs need it).',
    ]);
  });

  it('rejects malformed URLs', () => {
    const r = checkEnv({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: 'nope', NEXT_PUBLIC_SITE_URL: 'ftp://x' });
    expect(r.errors).toEqual(['NEXT_PUBLIC_SUPABASE_URL is not a valid URL.', 'NEXT_PUBLIC_SITE_URL is not a valid URL.']);
  });

  it('refuses half-configured billing and names what is missing', () => {
    const r = checkEnv({ ...GOOD, DODO_PAYMENTS_API_KEY: 'k' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('DODO_PAYMENTS_WEBHOOK_KEY, DODO_PRODUCT_PRO, DODO_PRODUCT_AGENCY');
  });

  it('validates the billing mode and warns loudly about live mode', () => {
    expect(checkEnv({ ...GOOD, DODO_PAYMENTS_ENVIRONMENT: 'prod' }).errors).toEqual(['DODO_PAYMENTS_ENVIRONMENT must be "test_mode" or "live_mode".']);
    expect(checkEnv({ ...GOOD, ...BILLING, DODO_PAYMENTS_ENVIRONMENT: 'live_mode' }).warnings[0]).toContain('real payments');
  });

  it('requires the encryption key to be 32 bytes of base64, and only warns when it is absent', () => {
    expect(checkEnv({ ...GOOD, TURNSTILE_ENC_KEY: 'AAEC' }).errors[0]).toContain('32 bytes');
    expect(checkEnv({ ...GOOD, TURNSTILE_ENC_KEY: 'not base64!' }).errors[0]).toContain('32 bytes');
    const absent = checkEnv({ ...GOOD, TURNSTILE_ENC_KEY: '' });
    expect(absent.errors).toEqual([]);
    expect(absent.warnings[0]).toContain('TURNSTILE_ENC_KEY');
  });
});
