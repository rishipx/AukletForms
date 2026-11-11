# Architecture

```
 HTML form / fetch()                         Browser
        |                                       |
        v                                       v
 Cloudflare Worker  ---- service role ---->  Supabase  <---- user JWT + RLS ----  Next.js dashboard
 (apps/worker)           (quota RPC,         (Postgres,                          (apps/web)
   |    |    |             inserts)           Auth, Realtime)                        |
   |    |    +--> Slack / Discord                  ^                                 v
   |    +-------> Resend (email)                   |                          Dodo checkout / portal
   +-- Turnstile verify                            +------ webhook (service role) --- Dodo Payments
```

## Components

| Path | Role | Runs on |
| --- | --- | --- |
| [`apps/worker`](../apps/worker) | Public ingestion API `POST /v1/f/:formId`: rate limit, CORS, honeypot, Turnstile, quota, email, Slack and Discord, daily maintenance | Cloudflare Workers |
| [`apps/web`](../apps/web) | Dashboard: magic-link login, forms, live submissions, CSV export, billing | Next.js 16 on Cloudflare Workers (or Vercel) |
| [`apps/selfhost-worker`](../apps/selfhost-worker) | Open-source, single-file, database-free edition (AGPL-3.0) | Cloudflare Workers |
| [`supabase`](../supabase) | Schema, Row Level Security, atomic quota, email budget, retention, pgTAP tests | Supabase (Postgres) |
| [`scripts`](../scripts) | Mock Supabase API and the end-to-end smoke test | Node.js |

## Request flow

1. The visitor posts to `/v1/f/:formId`. A per-IP rate limit, the payload size cap and the form lookup (memory cache, then KV, then Supabase) run first, so a flood costs almost nothing.
2. CORS is checked against the form's allowed domains, then the honeypot and, if enabled, Turnstile.
3. The monthly quota is consumed atomically (`consume_submission_quota`).
4. The visitor gets their response. Storing the submission, the daily email budget, the email, and the Slack and Discord messages happen afterwards in `waitUntil`, concurrently and independently, and the email outcome is recorded on the row.

## Design decisions

- **Atomic quota.** `consume_submission_quota()` checks and increments in one SQL statement, so concurrent submissions cannot overshoot a limit. Expired cycles roll over inside the same statement.
- **RLS plus a column guard.** Users can edit their own profile row, but a trigger blocks changes to plan, quota and billing columns, so nobody can upgrade themselves from the browser.
- **Idempotent, order-safe billing webhooks.** Each Dodo `webhook-id` is claimed once, every write is absolute, and a per-profile timestamp watermark discards late events, so a delayed `active` cannot undo a cancellation. See [Billing](./billing.md).
- **Free-tier guard rails.** Daily email caps (global and per form, enforced atomically in SQL), link-spam flagging, a 64 KiB payload cap, and a daily cron that purges old submissions by plan (30, 90 or 365 days) and keeps a free Supabase project from pausing.
- **Secrets at rest.** Turnstile secret keys are stored AES-256-GCM encrypted (`TURNSTILE_ENC_KEY`). The dashboard encrypts, the Worker decrypts at use, and the browser never receives them.
- **Form configuration is cached** in memory (30 s) in front of KV (60 s). Quota is never cached.
- **Deliberate duplication.** `secrets.ts` exists in both the Worker and the dashboard, and plan limits and retention periods exist in SQL and TypeScript. Contract tests (`apps/web/test/contracts.test.ts`) fail if the copies drift. This avoids workspace tooling that would complicate the open-source edition's one-click deploy.
- **Errors are RFC 7807** problem details (`application/problem+json`) with stable `type` slugs.
