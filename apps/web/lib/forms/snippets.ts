/**
 * Copy-paste integration snippets, generated from the user's live endpoint.
 * Built from line arrays (not template literals) so the output can freely
 * contain braces and dollar signs.
 */

export interface SnippetOptions {
  endpoint: string;
  turnstile: boolean;
}

export function htmlSnippet({ endpoint, turnstile }: SnippetOptions): string {
  const lines = [
    `<form action="${endpoint}" method="POST">`,
    '  <label>Name <input type="text" name="name" required></label>',
    '  <label>Email <input type="email" name="email" required></label>',
    '  <label>Message <textarea name="message" required></textarea></label>',
    '',
    '  <!-- Spam trap: invisible to people, irresistible to bots. Keep the name. -->',
    '  <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true"',
    '         style="position:absolute;left:-9999px">',
  ];
  if (turnstile) {
    lines.push(
      '',
      '  <!-- Cloudflare Turnstile: use YOUR site key (the public half of the secret you saved) -->',
      '  <div class="cf-turnstile" data-sitekey="YOUR_TURNSTILE_SITE_KEY"></div>',
      '  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>',
    );
  }
  lines.push('', '  <button type="submit">Send</button>', '</form>');
  return lines.join('\n');
}

export function reactSnippet({ endpoint, turnstile }: SnippetOptions): string {
  const lines = [
    "'use client';",
    '',
    "import { useState, type FormEvent } from 'react';",
    '',
    `const ENDPOINT = '${endpoint}';`,
    '',
    'export function ContactForm() {',
    "  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');",
    '  const [error, setError] = useState<string | null>(null);',
    '',
    '  async function onSubmit(event: FormEvent<HTMLFormElement>) {',
    '    event.preventDefault();',
    "    setStatus('sending');",
    '    setError(null);',
    '    const form = event.currentTarget;',
    '',
    '    const res = await fetch(ENDPOINT, {',
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },",
    '      body: JSON.stringify(Object.fromEntries(new FormData(form))),',
    '    });',
    '',
    '    if (res.ok) {',
    '      form.reset();',
    "      setStatus('sent');",
    '      return;',
    '    }',
    '    // Errors are RFC 7807 problem details: { type, title, status, detail }',
    '    const problem = await res.json().catch(() => null);',
    "    setError(problem?.detail ?? 'Something went wrong. Please try again.');",
    "    setStatus('error');",
    '  }',
    '',
    '  return (',
    '    <form onSubmit={onSubmit}>',
    '      <input name="name" placeholder="Name" required />',
    '      <input name="email" type="email" placeholder="Email" required />',
    '      <textarea name="message" placeholder="Message" required />',
    '      {/* Spam trap: keep hidden, keep the name */}',
    '      <input name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: \'absolute\', left: -9999 }} />',
  ];
  if (turnstile) {
    lines.push(
      '      {/* Turnstile injects a hidden cf-turnstile-response field that FormData picks up */}',
      '      <div className="cf-turnstile" data-sitekey="YOUR_TURNSTILE_SITE_KEY" />',
    );
  }
  lines.push(
    '      <button type="submit" disabled={status === \'sending\'}>',
    "        {status === 'sending' ? 'Sending…' : 'Send'}",
    '      </button>',
    "      {status === 'sent' && <p>Thanks! We'll be in touch.</p>}",
    '      {error && <p role="alert">{error}</p>}',
    '    </form>',
    '  );',
    '}',
  );
  if (turnstile) {
    lines.push('', '// Also load https://challenges.cloudflare.com/turnstile/v0/api.js once, e.g. with next/script.');
  }
  return lines.join('\n');
}

export function curlSnippet({ endpoint }: SnippetOptions): string {
  return [
    `curl -X POST '${endpoint}' \\`,
    "  -H 'Content-Type: application/json' \\",
    "  -H 'Accept: application/json' \\",
    '  -d \'{"name":"Ada Lovelace","email":"ada@example.com","message":"Hello from curl"}\'',
  ].join('\n');
}

/** PowerShell's line-continuation character. */
const BACKTICK = '`';

/** Windows PowerShell treats `curl` as an alias of Invoke-WebRequest, so it gets its own snippet. */
export function powershellSnippet({ endpoint }: SnippetOptions): string {
  return [
    `Invoke-RestMethod -Method Post -Uri '${endpoint}' ${BACKTICK}`,
    `  -ContentType 'application/json' ${BACKTICK}`,
    `  -Headers @{ Accept = 'application/json' } ${BACKTICK}`,
    '  -Body \'{"name":"Ada Lovelace","email":"ada@example.com","message":"Hello from PowerShell"}\'',
  ].join('\n');
}
