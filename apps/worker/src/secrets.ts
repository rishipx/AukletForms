/**
 * Secrets stored in the database (form Turnstile keys) are encrypted with AES-256-GCM.
 * The dashboard encrypts on save; the Worker decrypts at the moment of use, so the KV
 * cache, database dumps and backups only ever contain ciphertext.
 *
 * Format: "enc:v1:" + base64( 12-byte IV || ciphertext || 16-byte GCM tag )
 * Key:    TURNSTILE_ENC_KEY = base64 of 32 random bytes (`openssl rand -base64 32`)
 *
 * This file is duplicated in apps/web/lib/security/secrets.ts; both are tested against the same
 * fixed vector so they cannot drift apart.
 *
 * A value without the prefix is treated as plaintext and returned unchanged, so a form saved
 * without an encryption key keeps working.
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKey(keyBase64: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(keyBase64.trim());
  } catch {
    throw new Error('TURNSTILE_ENC_KEY is not valid base64');
  }
  if (raw.length !== KEY_BYTES) throw new Error(`TURNSTILE_ENC_KEY must decode to ${KEY_BYTES} bytes`);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [usage]);
}

export async function decryptSecret(value: string, keyBase64: string | undefined): Promise<string> {
  if (!isEncrypted(value)) return value;
  if (keyBase64 === undefined || keyBase64 === '') throw new Error('TURNSTILE_ENC_KEY is not set');
  const packed = fromBase64(value.slice(PREFIX.length));
  if (packed.length <= IV_BYTES + 16) throw new Error('encrypted secret is truncated');
  const key = await importKey(keyBase64, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) as BufferSource }, key, packed.slice(IV_BYTES) as BufferSource);
  return new TextDecoder().decode(plain);
}

/** `iv` is for deterministic test vectors only; production callers omit it for a random one. */
export async function encryptSecret(plain: string, keyBase64: string, iv: Uint8Array = crypto.getRandomValues(new Uint8Array(IV_BYTES))): Promise<string> {
  if (iv.length !== IV_BYTES) throw new Error('IV must be 12 bytes');
  const key = await importKey(keyBase64, 'encrypt');
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plain) as BufferSource));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return PREFIX + toBase64(packed);
}
