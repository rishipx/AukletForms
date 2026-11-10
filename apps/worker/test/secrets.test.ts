import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from '../src/secrets';

// Fixed vector shared with apps/web/test/secrets.test.ts. If either side changes the
// format, one of the two tests breaks, so the dashboard and Worker cannot drift apart.
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const PLAIN = '0x4AAAAAAA-turnstile-secret';
const VECTOR = 'enc:v1:oKGio6Slpqeoqaqr1mBIbASKQ/4jJKqncgiurQTFNXW/xCcP7mtSlFdfeKO3KzHp8cvTlF24Rg==';

describe('secrets', () => {
  it('matches the shared test vector in both directions', async () => {
    expect(await encryptSecret(PLAIN, KEY, IV)).toBe(VECTOR);
    expect(await decryptSecret(VECTOR, KEY)).toBe(PLAIN);
  });

  it('round-trips with a random IV and never produces the same ciphertext twice', async () => {
    const a = await encryptSecret(PLAIN, KEY);
    const b = await encryptSecret(PLAIN, KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe(PLAIN);
    expect(isEncrypted(a)).toBe(true);
  });

  it('passes legacy plaintext through unchanged', async () => {
    expect(isEncrypted('0x4AAA')).toBe(false);
    expect(await decryptSecret('0x4AAA', undefined)).toBe('0x4AAA');
  });

  it('refuses tampered ciphertext, the wrong key, a missing key and a malformed key', async () => {
    const tampered = VECTOR.slice(0, -6) + (VECTOR.slice(-6, -5) === 'A' ? 'B' : 'A') + VECTOR.slice(-5);
    await expect(decryptSecret(tampered, KEY)).rejects.toThrow();
    await expect(decryptSecret(VECTOR, 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=')).rejects.toThrow();
    await expect(decryptSecret(VECTOR, undefined)).rejects.toThrow(/not set/);
    await expect(decryptSecret(VECTOR, 'not-base64!!')).rejects.toThrow();
    await expect(decryptSecret(VECTOR, 'AAEC')).rejects.toThrow(/32 bytes/);
    await expect(decryptSecret('enc:v1:AAAA', KEY)).rejects.toThrow(/truncated/);
  });
});
