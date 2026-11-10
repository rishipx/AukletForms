import { describe, expect, it } from 'vitest';
import { normalizeDomain, parseFormInput } from '@/lib/forms/validation';

function fd(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

const VALID: Array<[string, string]> = [
  ['name', '  Contact form '],
  ['target_email', 'Owner@Example.com'],
];

describe('normalizeDomain', () => {
  it('canonicalizes hosts, ports, wildcards and pasted URLs', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com');
    expect(normalizeDomain('https://example.com/contact?x=1')).toBe('example.com');
    expect(normalizeDomain('localhost:3000')).toBe('localhost:3000');
    expect(normalizeDomain('*.Example.com')).toBe('*.example.com');
  });

  it('rejects junk', () => {
    for (const bad of ['', '   ', 'ex*ample.com', '*', 'user@example.com', 'not a domain', 'http://']) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe('parseFormInput', () => {
  it('accepts a minimal valid form and normalizes it', () => {
    const r = parseFormInput(fd(VALID));
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Contact form',
        target_email: 'owner@example.com',
        allowed_domains: [],
        redirect_url: null,
        slack_webhook_url: null,
        discord_webhook_url: null,
        enable_turnstile: false,
        turnstile_secret_key: null,
      },
    });
  });

  it('dedupes and normalizes allowed domains', () => {
    const r = parseFormInput(
      fd([...VALID, ['allowed_domains', 'Example.com'], ['allowed_domains', 'https://example.com/x'], ['allowed_domains', 'localhost:3000']]),
    );
    expect(r.ok && r.value.allowed_domains).toEqual(['example.com', 'localhost:3000']);
  });

  it('reports every invalid field at once', () => {
    const r = parseFormInput(
      fd([
        ['name', ''],
        ['target_email', 'nope'],
        ['allowed_domains', 'not a domain'],
        ['redirect_url', 'javascript:alert(1)'],
        ['slack_webhook_url', 'https://evil.example/services/x'],
        ['discord_webhook_url', 'http://discord.com/api/webhooks/1/x'],
        ['enable_turnstile', 'on'],
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual([
        'allowed_domains',
        'discord_webhook_url',
        'name',
        'redirect_url',
        'slack_webhook_url',
        'target_email',
        'turnstile_secret_key',
      ]);
    }
  });

  it('accepts genuine Slack and Discord webhooks', () => {
    const r = parseFormInput(
      fd([
        ...VALID,
        ['slack_webhook_url', 'https://hooks.slack.com/services/T000/B000/xxxx'],
        ['discord_webhook_url', 'https://discord.com/api/webhooks/123/abc'],
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it('requires a secret when Turnstile is on, and drops it when off', () => {
    expect(parseFormInput(fd([...VALID, ['enable_turnstile', 'on']])).ok).toBe(false);
    const on = parseFormInput(fd([...VALID, ['enable_turnstile', 'on'], ['turnstile_secret_key', ' 0x4AAA ']]));
    expect(on.ok && on.value.turnstile_secret_key).toBe('0x4AAA');
    const off = parseFormInput(fd([...VALID, ['turnstile_secret_key', '0x4AAA']]));
    expect(off.ok && off.value.turnstile_secret_key).toBeNull();
  });

  it('keeps the stored Turnstile secret when the field is left blank on an edit', () => {
    const keep = parseFormInput(fd([...VALID, ['enable_turnstile', 'on']]), { hasStoredSecret: true });
    expect(keep.ok && keep.value.turnstile_secret_key).toBeUndefined();
    expect(keep.ok && 'turnstile_secret_key' in keep.value).toBe(true);
    const replace = parseFormInput(fd([...VALID, ['enable_turnstile', 'on'], ['turnstile_secret_key', 'new']]), { hasStoredSecret: true });
    expect(replace.ok && replace.value.turnstile_secret_key).toBe('new');
    // Turning it off clears the secret even if one was stored; with none stored a blank field is still an error.
    const off = parseFormInput(fd([...VALID]), { hasStoredSecret: true });
    expect(off.ok && off.value.turnstile_secret_key).toBeNull();
    expect(parseFormInput(fd([...VALID, ['enable_turnstile', 'on']]), { hasStoredSecret: false }).ok).toBe(false);
  });

  it('enforces name length', () => {
    expect(
      parseFormInput(
        fd([
          ['name', 'x'.repeat(121)],
          ['target_email', 'a@b.co'],
        ]),
      ).ok,
    ).toBe(false);
  });
});
