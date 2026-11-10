# Auklet Forms

Form endpoints for developers. Point an HTML form or a `fetch()` call at Auklet and receive each submission by email, Slack and Discord, with a live dashboard, spam protection and subscription billing.

Built to run entirely on free tiers: Cloudflare Workers, Supabase, Resend and Dodo Payments.

## Repository layout

| Path | What it is | Runs on |
| --- | --- | --- |
| [`apps/worker`](./apps/worker) | Public ingestion API `POST /v1/f/:formId` | Cloudflare Workers |
| [`apps/web`](./apps/web) | Dashboard: login, forms, live submissions, CSV export, billing | Next.js 15 on Cloudflare Workers (or Vercel) |
| [`apps/selfhost-worker`](./apps/selfhost-worker) | Open-source, single-file, database-free edition (AGPL-3.0) | Cloudflare Workers |
| [`supabase`](./supabase) | Migrations (tables, RLS, atomic quota, email budget, retention) and pgTAP tests | Supabase (Postgres) |
| [`scripts`](./scripts) | Mock Supabase API and an end-to-end smoke test | Node.js |
| [`docs`](./docs) | Setup guides, architecture, operations, security | |

## Get started

```bash
npm run install:all   # install every app's dependencies
npm test              # run all unit and contract tests
```

Then follow [docs/getting-started](./docs/getting-started/01-prerequisites.md) to create the accounts, apply the database migrations and deploy. The [documentation index](./docs/README.md) lists everything else.

## Architecture in short

```
 HTML form / fetch()  --->  Cloudflare Worker  --->  Supabase (Postgres, Auth, Realtime)  <---  Next.js dashboard
                               |    |    |                                                          |
                               |    |    +--> Slack / Discord                                       +--> Dodo Payments
                               |    +-------> Resend (email)
                               +-- Turnstile
```

Highlights: atomic quota in SQL, Row Level Security with a column guard, idempotent and order-safe billing webhooks, daily email caps, plan-based retention, encrypted Turnstile secrets. Details in [docs/architecture.md](./docs/architecture.md).

## Development

| Command | What it does |
| --- | --- |
| `npm run install:all` | `npm ci` in every app |
| `npm test` | Tests for the Worker, the dashboard and the self-host Worker |
| `npm run typecheck` | Type checks for all three apps |
| `npm run format` / `npm run format:check` | Format the code with Prettier / verify formatting |
| `npx supabase test db` | Database tests (needs Docker) |
| `node scripts/smoke.mjs` | End-to-end check of a running Worker ([how](./docs/getting-started/04-dashboard-local.md#optional-api-level-smoke-test)) |

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs all of these on every push. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Auklet Forms is free software, licensed under the [GNU General Public License v3.0](./LICENSE) (`GPL-3.0-only`).

The self-host edition in [`apps/selfhost-worker`](./apps/selfhost-worker) is licensed separately under the [GNU Affero General Public License v3.0](./apps/selfhost-worker/LICENSE) (`AGPL-3.0-only`), so that modified copies offered over a network stay open. GPLv3 and AGPLv3 are compatible with each other (section 13 of each license), so the two parts can live in one repository.

Copyright (C) 2026 rishipx
