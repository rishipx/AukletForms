# 1. Prerequisites

Follow the guides in `docs/getting-started` in order. Each step says what you should see afterwards, so you know it worked before moving on. Allow about 90 minutes the first time.

Everything runs on free tiers. Use Dodo Payments in **test mode** only.

| Guide | You will | Time |
| --- | --- | --- |
| [1. Prerequisites](./01-prerequisites.md) | Install tools, create accounts, run the unit tests | 25 min |
| [2. Database](./02-database.md) | Run the database tests, create the hosted database | 25 min |
| [3. Ingestion Worker](./03-ingestion-worker.md) | Set up email, deploy the public API | 15 min |
| [4. Dashboard (local)](./04-dashboard-local.md) | Run the dashboard, first end-to-end test | 15 min |
| [5. Billing](./05-billing.md) | Add Dodo Payments in test mode | 20 min |
| [6. Deploy the dashboard](./06-deploy-dashboard.md) | Host the dashboard on Cloudflare (or Vercel) | 15 min |
| [7. Publish](./07-publish.md) | Publish the repository, CI, the open-source edition | 15 min |

Afterwards, read [Operations](../operations.md) to keep the project running on free tiers.

## Install

- **Node.js 20 or newer** (`node -v`). CI uses the version in `.nvmrc`.
- **Git**.
- **Docker**, running. Only needed for the local database tests in guide 2.
- **A tunnel tool** (guide 5): `cloudflared` or ngrok, so Dodo can reach your local webhook endpoint.

The Supabase and Wrangler command-line tools need no install: use `npx supabase ...` and `npx wrangler ...`.

## Create free accounts

| Service | Used for | Site |
| --- | --- | --- |
| GitHub | Code, CI, the Deploy button | github.com |
| Supabase | Database, login, live updates | supabase.com |
| Cloudflare | Hosts the ingestion Worker and the dashboard | cloudflare.com |
| Resend | Sends notification and login emails | resend.com |
| Dodo Payments | Billing (test mode) | dodopayments.com |
| Vercel | Optional fallback host for the dashboard | vercel.com |

Note **which email you sign up to Resend with**. Until you verify a domain, Resend only delivers to that address.

## Install the code and run the unit tests

From the repository root:

```bash
npm run install:all
npm test
```

**Expect:** three test runs pass (ingestion Worker, dashboard, self-host Worker). They need no accounts or network. If anything fails, fix that before continuing.

Next: [2. Database](./02-database.md)
