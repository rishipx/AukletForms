import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/security/secrets';

// Fixed vector shared with apps/worker/test/secrets.test.ts. If either side changes the
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

  it('round-trips with a random IV', async () => {
    const a = await encryptSecret(PLAIN, KEY);
    const b = await encryptSecret(PLAIN, KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe(PLAIN);
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toContain(PLAIN);
  });

  it('rejects a bad key or a bad IV', async () => {
    await expect(encryptSecret(PLAIN, 'AAEC')).rejects.toThrow(/32 bytes/);
    await expect(encryptSecret(PLAIN, KEY, new Uint8Array(8))).rejects.toThrow(/12 bytes/);
  });
});
