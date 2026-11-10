# Auklet dashboard

The Auklet Forms dashboard: Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Supabase Auth (magic link) and Realtime, and Dodo Payments billing. It runs on Cloudflare Workers through OpenNext, and unchanged on Vercel.

## Features

- Passwordless sign-in, forms with per-form settings (allowed domains, redirect, Slack and Discord webhooks, Turnstile)
- Live submissions table with a detail drawer, spam and email-outcome badges, and CSV export
- Plan usage meter, Dodo checkout and customer portal, account deletion

## Develop

```bash
npm ci
cp .env.example .env.local   # every variable is described in docs/configuration.md
npm run dev                  # http://localhost:3000
```

The app validates its environment at startup (`instrumentation.ts`): in production a missing or malformed value stops the boot with a readable message; in development it only warns. All migrations in [`supabase/migrations`](../../supabase/migrations) must be applied to the Supabase project.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Unit and contract tests |
| `npm run typecheck` | `tsc --noEmit` (run after the first build or dev start, which generates `next-env.d.ts`) |
| `npm run cf:preview` | Build with OpenNext and run locally in the Workers runtime (reads `.dev.vars`) |
| `npm run cf:deploy` | Build and deploy to Cloudflare |

## Structure

```
app/                 Routes: pages, server actions, API routes (billing, webhooks)
  api/               Billing checkout and portal, Dodo webhook receiver
  auth/              Login and magic-link callback
  dashboard/         Forms, form detail, settings, CSV export
components/          UI by feature: forms/, submissions/, billing/, account/, shared/, ui/ (primitives)
lib/
  billing/           Plans, Dodo client, webhook verification and event handlers
  config/            Environment access and the startup check
  forms/             Form validation and integration snippets
  http/              RFC 7807 responses and same-origin checks
  security/          Secret encryption (shared with the Worker)
  submissions/       CSV, payload summaries, email-outcome badges
  supabase/          Browser, server, admin and middleware clients
test/                Mirrors lib/, plus contract tests against the SQL migrations
```

## Supabase Auth settings

In the Supabase dashboard (**Authentication**):

1. **URL Configuration:** add `http://localhost:3000/auth/callback` and your production `https://<your-domain>/auth/callback` to Redirect URLs, and set **Site URL** to your production URL.
2. **Providers > Email:** keep "Confirm email" on; magic links need no password.
3. Optional, recommended: make links work when opened on a different device or inside an email app's in-app browser. The default PKCE flow only completes in the browser that requested the link. Under **Email Templates > Magic Link**, set the link to:

   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Sign in to Auklet</a>
   ```

   `/auth/callback` handles both flows.
4. **Production email:** configure custom SMTP (for example Resend) under SMTP Settings. The built-in mailer is heavily rate-limited. See [Getting started: Database](../../docs/getting-started/02-database.md#login-emails).

## Billing, secrets and hosting

- Billing: [docs/billing.md](../../docs/billing.md)
- Turnstile secret encryption: per-form Turnstile secret keys are encrypted before they reach the database (`lib/security/secrets.ts`, AES-256-GCM). Set the same `TURNSTILE_ENC_KEY` here and on the ingestion Worker. The edit form never shows a stored secret; leaving the field blank keeps it.
- Hosting on Cloudflare or Vercel: [docs/getting-started/06-deploy-dashboard.md](../../docs/getting-started/06-deploy-dashboard.md)
- Account deletion (Settings > Delete account) removes the user, their forms and their submissions. It is blocked while a subscription is on file, so a paying customer cannot orphan a Dodo subscription.

## Notes

- TypeScript is pinned to 5.x because Next 15 loads `next.config.ts` through the TypeScript API, which TypeScript 7 does not provide.
- Form configuration edits reach the ingestion Worker within about a minute (30 s in-isolate memory cache, 60 s KV TTL).
