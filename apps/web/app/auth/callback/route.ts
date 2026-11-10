import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/utils';

const OTP_TYPES: ReadonlySet<string> = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

/**
 * Completes the magic-link sign-in. Handles both Supabase flows:
 *  - PKCE:       /auth/callback?code=...                      (default; must open the link in the same browser)
 *  - token hash: /auth/callback?token_hash=...&type=email     (opt-in via the email template; works across devices)
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  const supabase = await createClient();
  let failed = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = error !== null;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    failed = error !== null;
  }

  if (failed) return NextResponse.redirect(`${origin}/auth/login?error=link_invalid`);
  return NextResponse.redirect(`${origin}${next}`);
}
