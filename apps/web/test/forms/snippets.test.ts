import { describe, expect, it } from 'vitest';
import { curlSnippet, htmlSnippet, powershellSnippet, reactSnippet } from '@/lib/forms/snippets';

describe('integration snippets', () => {
  const endpoint = 'https://api.auklet.dev/v1/f/11111111-1111-4111-8111-111111111111';

  it('embed the live endpoint in every format', () => {
    for (const make of [htmlSnippet, reactSnippet, curlSnippet, powershellSnippet]) {
      expect(make({ endpoint, turnstile: false })).toContain(endpoint);
    }
  });

  it('include the honeypot and JSON Accept header that the Worker expects', () => {
    expect(htmlSnippet({ endpoint, turnstile: false })).toContain('name="_gotcha"');
    expect(reactSnippet({ endpoint, turnstile: false })).toContain("Accept: 'application/json'");
    expect(curlSnippet({ endpoint, turnstile: false })).toContain('Accept: application/json');
  });

  it('give PowerShell its own command, with a valid JSON body and no bash line continuations', () => {
    const snippet = powershellSnippet({ endpoint, turnstile: false });
    expect(snippet).toContain('Invoke-RestMethod');
    expect(snippet).toContain("Accept = 'application/json'");
    expect(snippet).not.toContain('\\\n');
    const body = /-Body '(.*)'$/.exec(snippet)?.[1] ?? '';
    expect(JSON.parse(body)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('add the Turnstile widget only when enabled', () => {
    expect(htmlSnippet({ endpoint, turnstile: true })).toContain('cf-turnstile');
    expect(htmlSnippet({ endpoint, turnstile: false })).not.toContain('cf-turnstile');
  });
});
