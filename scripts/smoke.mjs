#!/usr/bin/env node
// End-to-end smoke test of the ingestion Worker against a Supabase-compatible API.
//
//   Real stack:  npx supabase start   -> then export the three variables below
//   No Docker:   node scripts/mock-supabase.mjs   (uses the defaults below)
//
//   WORKER_URL                 where the Worker listens        (default http://127.0.0.1:8787)
//   SUPABASE_URL               API base URL                    (default http://127.0.0.1:54399)
//   SUPABASE_SERVICE_ROLE_KEY  service-role / secret key       (default sb_secret_local)
//
// Creates a throwaway user and form, exercises the public endpoint, then deletes the user (which
// cascades to the form and submissions). Exits non-zero if any check fails.

const WORKER = (process.env.WORKER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SUPA = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54399').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'sb_secret_local';

const headers = { apikey: KEY, 'content-type': 'application/json', ...(KEY.startsWith('eyJ') ? { authorization: `Bearer ${KEY}` } : {}) };
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${SUPA}${path}`, {
    method,
    headers: { ...headers, prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function waitForRow(id, ready) {
  for (let i = 0; i < 40; i++) {
    const { data } = await api('GET', `/rest/v1/submissions?select=*&id=eq.${id}`);
    const row = Array.isArray(data) ? data[0] : undefined;
    if (row && ready(row)) return row;
    await sleep(250);
  }
  return undefined;
}

const post = (formId, body, extra = {}) =>
  fetch(`${WORKER}/v1/f/${formId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...extra },
    body: JSON.stringify(body),
  });

let userId;
try {
  const health = await fetch(`${WORKER}/healthz`).catch(() => null);
  check('worker is reachable at /healthz', health?.status === 200, `is the Worker running at ${WORKER}?`);
  if (health?.status !== 200) process.exit(1);

  const email = `smoke-${Date.now()}@example.com`;
  const user = await api('POST', '/auth/v1/admin/users', { email, email_confirm: true });
  userId = user.data?.id;
  check('created a throwaway user', Boolean(userId), `HTTP ${user.status}`);
  const form = await api('POST', '/rest/v1/forms', { user_id: userId, name: 'Smoke test', target_email: email, allowed_domains: [] });
  const formId = form.data?.[0]?.id;
  check('created a form', Boolean(formId), `HTTP ${form.status}`);

  // 1. A normal submission is accepted, stored under the returned id, and its email outcome recorded.
  const ok = await post(formId, { name: 'Ada', email, message: 'Hello from the smoke test' });
  const okBody = await ok.json().catch(() => ({}));
  check('accepts a submission (200 + id)', ok.status === 200 && okBody.success === true && typeof okBody.id === 'string', `HTTP ${ok.status}`);
  const stored = await waitForRow(okBody.id, (r) => r.notify_status && r.notify_status !== 'pending');
  check('stored the submission under the returned id', stored?.payload?.name === 'Ada');
  check(
    'recorded the email outcome (sent, or failed with a fake Resend key)',
    ['sent', 'failed'].includes(stored?.notify_status),
    String(stored?.notify_status),
  );
  check('not flagged as spam', stored?.is_spam === false);

  // 2. Link-stuffed messages are stored as spam and never emailed.
  const links = Array.from({ length: 5 }, (_, i) => `https://spam${i}.example/x`).join(' ');
  const spam = await post(formId, { name: 'Bot', message: links });
  const spamBody = await spam.json().catch(() => ({}));
  const spamRow = await waitForRow(spamBody.id, () => true);
  check(
    'flags link spam and skips its email',
    spamRow?.is_spam === true && spamRow?.notify_status === 'skipped_spam',
    JSON.stringify({ spam: spamRow?.is_spam, status: spamRow?.notify_status }),
  );

  // 3. A tripped honeypot looks like success but stores nothing.
  const bot = await post(formId, { name: 'Bot', _gotcha: 'gotcha' });
  const botBody = await bot.json().catch(() => ({}));
  await sleep(600);
  const botRows = await api('GET', `/rest/v1/submissions?select=id&id=eq.${botBody.id}`);
  check('honeypot returns success but stores nothing', bot.status === 200 && Array.isArray(botRows.data) && botRows.data.length === 0);

  // 4. Oversized submissions are refused with a problem+json document.
  const big = await post(formId, { message: 'x'.repeat(70_000) });
  check('rejects oversized submissions with 413', big.status === 413 && (big.headers.get('content-type') ?? '').includes('problem+json'), `HTTP ${big.status}`);

  // 5. Unknown forms and bad ids.
  const missing = await post('00000000-0000-4000-8000-000000000000', { a: 1 });
  check('unknown form id returns 404', missing.status === 404, `HTTP ${missing.status}`);
} catch (err) {
  check('smoke test ran to completion', false, err instanceof Error ? err.message : String(err));
} finally {
  if (userId) await api('DELETE', `/auth/v1/admin/users/${userId}`).catch(() => undefined);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 1 - 1 : 1);
