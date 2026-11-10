import { isRecord } from './types';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048; // documented Turnstile limit

export type TurnstileResult = { success: true } | { success: false; errorCodes: string[] };

/**
 * Verify a Turnstile token with the form's own secret key.
 * Resolves with `success: false` for a rejected token; THROWS if Cloudflare
 * cannot be reached, so the caller can fail closed with a 503 instead of
 * wrongly telling a real user they are a bot.
 */
export async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<TurnstileResult> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { success: false, errorCodes: ['invalid-input-response'] };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) body.set('remoteip', remoteIp);

  const res = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Turnstile siteverify returned HTTP ${res.status}`);

  const data: unknown = await res.json();
  if (!isRecord(data)) throw new Error('Turnstile siteverify returned an unexpected body');
  if (data['success'] === true) return { success: true };

  const codes = data['error-codes'];
  return {
    success: false,
    errorCodes: Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [],
  };
}
