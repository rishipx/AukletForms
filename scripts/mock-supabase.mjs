#!/usr/bin/env node
// A tiny stand-in for the parts of Supabase the Worker and smoke test use, so
// `npm run smoke` can run without Docker. It is NOT a faithful Supabase: use the real
// local stack (`npx supabase start`) to test SQL, RLS and quotas.
//
//   node scripts/mock-supabase.mjs [port]      (default 54399)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.argv[2] ?? 54399);
const users = new Map();
const forms = new Map();
const submissions = new Map();
const quota = new Map(); // userId -> remaining
const emailCounts = new Map(); // scope -> sent
const filterId = (url) => new URL(url, 'http://x').searchParams.get('id')?.replace(/^eq\./, '') ?? null;

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const body = raw ? JSON.parse(raw) : {};
  const path = new URL(req.url, 'http://x').pathname;
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };

  if (req.method === 'POST' && path === '/auth/v1/admin/users') {
    const id = randomUUID();
    users.set(id, { id, email: body.email });
    quota.set(id, 250);
    return send(200, { id, email: body.email });
  }
  if (req.method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) {
    const id = path.split('/').pop();
    users.delete(id);
    for (const [fid, f] of forms)
      if (f.user_id === id) {
        forms.delete(fid);
        for (const [sid, s] of submissions) if (s.form_id === fid) submissions.delete(sid);
      }
    return send(200, {});
  }
  if (path === '/rest/v1/forms') {
    if (req.method === 'POST') {
      const row = {
        id: randomUUID(),
        allowed_domains: [],
        redirect_url: null,
        slack_webhook_url: null,
        discord_webhook_url: null,
        enable_turnstile: false,
        turnstile_secret_key: null,
        ...body,
      };
      forms.set(row.id, row);
      return send(201, [row]);
    }
    const f = forms.get(filterId(req.url));
    return send(200, f ? [f] : []);
  }
  if (path === '/rest/v1/rpc/consume_submission_quota') {
    const left = quota.get(body.p_user_id) ?? 0;
    if (left <= 0) return send(200, false);
    quota.set(body.p_user_id, left - 1);
    return send(200, true);
  }
  if (path === '/rest/v1/rpc/consume_email_slot') {
    const global = emailCounts.get('global') ?? 0;
    const form = emailCounts.get(body.p_form_id) ?? 0;
    if (global >= body.p_global_cap) return send(200, 'global_cap');
    if (form >= body.p_form_cap) return send(200, 'form_cap');
    emailCounts.set('global', global + 1);
    emailCounts.set(body.p_form_id, form + 1);
    return send(200, 'ok');
  }
  if (path === '/rest/v1/rpc/purge_old_data') return send(200, { submissions: 0, billing_events: 0, email_counters: 0 });
  if (path === '/rest/v1/submissions') {
    if (req.method === 'POST') {
      submissions.set(body.id, { ...body, created_at: new Date().toISOString() });
      return send(201);
    }
    if (req.method === 'PATCH') {
      const id = filterId(req.url);
      if (submissions.has(id)) Object.assign(submissions.get(id), body);
      return send(204);
    }
    const s = submissions.get(filterId(req.url));
    return send(200, s ? [s] : []);
  }
  if (path === '/__quota' && req.method === 'POST') {
    quota.set(body.userId, body.remaining);
    return send(200, {});
  }
  send(404, { message: `mock: no route for ${req.method} ${path}` });
});

server.listen(port, '127.0.0.1', () => console.log(`mock supabase listening on http://127.0.0.1:${port}`));
