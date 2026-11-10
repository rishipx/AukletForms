# Auklet ingestion Worker

The public API behind every Auklet form: `POST /v1/f/:formId` on Cloudflare Workers. It validates the request, stores the submission in Supabase and fans it out to email, Slack and Discord.

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /v1/f/:formId` | Accepts `application/json`, `application/x-www-form-urlencoded` and `multipart/form-data`. Returns `{ "success": true, "id": "..." }` for JSON clients and a redirect for plain HTML form posts |
| `OPTIONS /v1/f/:formId` | CORS preflight |
| `GET /thanks` | Built-in thank-you page |
| `GET /healthz` | Liveness check |

Errors are RFC 7807 `application/problem+json` with a stable `type` slug (`not-found`, `origin-not-allowed`, `turnstile-failed`, `quota-exceeded`, `rate-limited`, `payload-too-large`, ...).

## Request pipeline

1. Optional per-IP rate limit (fails open)
2. Form lookup: memory cache, then KV, then Supabase
3. CORS check against the form's allowed domains
4. Body parsing with size limits, then honeypot and Turnstile
5. Atomic monthly quota (`consume_submission_quota`)
6. Response to the visitor
7. In the background: store the row, settle the daily email budget, send the email and the Slack and Discord messages, record the email outcome

A scheduled trigger (`scheduled()`, daily) runs the retention purge and keeps a free Supabase project awake.

## Structure

```
src/
  index.ts         Worker entry: fetch and scheduled handlers
  handler.ts       Routing and the request pipeline
  dispatch.ts      Background work: storage, email budget, email, Slack, Discord
  config.ts        Form configuration cache (memory in front of KV)
  supabase.ts      Minimal PostgREST client (fetch only, no SDK)
  cors.ts          Allowed-domain matching and CORS headers
  parse.ts         Body parsing with size and field limits
  spam.ts          Honeypot and link-spam heuristics
  turnstile.ts     Cloudflare Turnstile verification
  secrets.ts       AES-256-GCM decryption of stored Turnstile secrets
  format.ts        Email, Slack and Discord message builders
  problem.ts       RFC 7807 error responses
  maintenance.ts   Daily retention purge
test/              Unit tests and request-level tests with fake upstream services
```

## Develop and deploy

```bash
npm ci
cp .dev.vars.example .dev.vars   # local secrets, never committed
npm run dev                      # wrangler dev
npm test
npm run deploy                   # see docs/getting-started/03-ingestion-worker.md first
```

Configuration is described in [docs/configuration.md](../../docs/configuration.md) and commented in [`wrangler.toml`](./wrangler.toml).
