# Configuration reference

Templates: [`apps/web/.env.example`](../apps/web/.env.example), [`apps/web/.dev.vars.example`](../apps/web/.dev.vars.example), [`apps/worker/.dev.vars.example`](../apps/worker/.dev.vars.example), [`apps/worker/wrangler.toml`](../apps/worker/wrangler.toml).

Only the `*.example` templates are committed. Real values live in `.env.local` / `.dev.vars` (ignored by Git) and in each platform's secret store.

## Dashboard (`apps/web`)

| Variable | Secret | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | No | Project URL. Baked in at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Publishable or anon key. Baked in at build time. |
| `NEXT_PUBLIC_SITE_URL` | No | Public URL of the dashboard (login links, billing return URLs). Baked in at build time. |
| `NEXT_PUBLIC_INGEST_URL` | No | Base URL of the ingestion Worker, used in the copy-paste snippets. Baked in at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server-side only. Bypasses Row Level Security. |
| `TURNSTILE_ENC_KEY` | **Yes** | Base64 of 32 bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Must equal the Worker's value. |
| `DODO_PAYMENTS_API_KEY` | **Yes** | Billing is optional, but these four must be set together. |
| `DODO_PAYMENTS_WEBHOOK_KEY` | **Yes** | Signing key of the webhook endpoint. |
| `DODO_PRODUCT_PRO`, `DODO_PRODUCT_AGENCY` | No | Subscription product ids (`pdt_...`). |
| `DODO_PAYMENTS_ENVIRONMENT` | No | `test_mode` (default) or `live_mode`. |

On Cloudflare the server-side values are Worker secrets (`npx wrangler secret put NAME`); on Vercel they are environment variables.

## Ingestion Worker (`apps/worker`)

| Variable | Secret | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | No | In `wrangler.toml`. |
| `EMAIL_FROM` | No | In `wrangler.toml`. Must be a sender on a domain verified in Resend (or `onboarding@resend.dev` for testing). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | `npx wrangler secret put`. |
| `RESEND_API_KEY` | **Yes** | `npx wrangler secret put`. |
| `TURNSTILE_ENC_KEY` | **Yes** | Same value as the dashboard's. |
| `EMAIL_DAILY_GLOBAL_CAP` | No | Optional. Emails per UTC day across all forms. Default 90. |
| `EMAIL_DAILY_FORM_CAP` | No | Optional. Emails per UTC day for one form. Default 25. |
| `THANK_YOU_URL` | No | Optional. Replaces the built-in `/thanks` page. |
| `FORM_CACHE_TTL_SECONDS` | No | Optional. KV cache TTL, minimum 60. |
| `FORM_CACHE` | n/a | KV namespace binding. |
| `RATE_LIMITER` | n/a | Optional rate-limit binding (`[[ratelimits]]` in `wrangler.toml`). |

## GitHub Actions secrets

| Secret | Used by | Notes |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Backup workflow | Session-pooler connection string (IPv4). |
| `BACKUP_PASSPHRASE` | Backup workflow | Any long random string. Keep a copy elsewhere. |
