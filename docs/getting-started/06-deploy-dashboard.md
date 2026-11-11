# 6. Deploy the dashboard

By default the dashboard runs on Cloudflare as a second Worker (`auklet-web`) next to the ingestion Worker, in the same free account. It uses the [OpenNext](https://opennext.js.org/cloudflare) adapter, already configured in `apps/web` (`open-next.config.ts`, `wrangler.jsonc`). Vercel works unchanged as a fallback; see the end of this guide.

| | Cloudflare Workers (default) | Vercel Hobby (fallback) |
| --- | --- | --- |
| Commercial use on the free plan | Not restricted in the terms reviewed | Not allowed |
| Free usage | 100,000 requests a day | 100,000 function invocations and 100 GB bandwidth a month |
| Per-request limit | 10 ms of CPU time | 10 seconds of duration |
| Next.js support | Through the OpenNext adapter | Native |

Check the providers' current pricing pages before relying on these numbers.

## Deploy to Cloudflare

You are already logged in to Wrangler from [guide 3](./03-ingestion-worker.md).

1. **Choose the dashboard address.** It is `https://auklet-web.YOUR-NAME.workers.dev`, where `YOUR-NAME` is the same account subdomain as your ingestion Worker URL. Put it in `apps/web/.env.local`:

   ```bash
   NEXT_PUBLIC_SITE_URL=https://auklet-web.YOUR-NAME.workers.dev
   NEXT_PUBLIC_INGEST_URL=https://auklet-worker.YOUR-NAME.workers.dev
   ```

   `NEXT_PUBLIC_*` values are baked in at **build** time, which is why they live in `.env.local` and not in Cloudflare.
2. **Build and deploy:**

   ```bash
   cd apps/web
   npm run cf:deploy
   ```

   **Expect:** it ends by printing the dashboard URL. Opening it now shows an error about missing configuration. That is the startup check working; the secrets come next.
3. **Set the server secrets** (paste each value when prompted; `TURNSTILE_ENC_KEY` must equal the ingestion Worker's value):

   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put TURNSTILE_ENC_KEY
   ```

   **Billing is optional.** With none of the Dodo variables set, the dashboard runs without billing, so you can deploy and test everything first. To turn billing on, set all five together (the dashboard refuses a half-configured setup) after creating the webhook endpoint in step 5:

   ```bash
   npx wrangler secret put DODO_PAYMENTS_API_KEY
   npx wrangler secret put DODO_PAYMENTS_WEBHOOK_KEY
   npx wrangler secret put DODO_PRODUCT_PRO
   npx wrangler secret put DODO_PRODUCT_AGENCY
   npx wrangler secret put DODO_PAYMENTS_ENVIRONMENT      # type: test_mode
   ```

4. **Supabase > Authentication > URL Configuration:** set **Site URL** to the dashboard URL and add `https://auklet-web.YOUR-NAME.workers.dev/auth/callback` to **Redirect URLs** (keep the localhost entry for development).
5. **Dodo > Developer > Webhooks:** add an endpoint `https://auklet-web.YOUR-NAME.workers.dev/api/webhooks/dodo` with the same ten events as in [guide 5](./05-billing.md). Copy its **signing key** and run `npx wrangler secret put DODO_PAYMENTS_WEBHOOK_KEY` again with it (it differs from the tunnel endpoint's key).
6. Repeat the [walkthrough](./04-dashboard-local.md#walk-through-the-product) on the live URL.
7. **Check CPU time.** Free Workers get 10 ms of CPU per request, and server-rendering a Next.js page can exceed it (Cloudflare error 1102). Open the dashboard, a form page and Settings several times, then check **Workers & Pages > auklet-web > Metrics** for CPU time and errors. If pages fail or sit near the limit, use the fallback below or Cloudflare's paid Workers plan.

To redeploy after a change, run `npm run cf:deploy` again. Secrets persist between deploys.

## Before you share the link publicly

Supabase's built-in email service is meant for trying things out: it is heavily rate limited and, on current projects, only delivers to addresses on your own Supabase team. A stranger who tries to sign up may never receive a magic link. Check in a private window with an address that is not yours. If it does not arrive:

1. In Resend, verify your domain (**Domains > Add Domain**) and add the DNS records it shows.
2. In Supabase, open **Authentication > Emails > SMTP Settings**, turn on custom SMTP and enter Resend's SMTP details (host `smtp.resend.com`, user `resend`, your API key as the password, and a sender on the verified domain).
3. Change `EMAIL_FROM` in `apps/worker/wrangler.toml` to an address on that domain and redeploy the Worker, so form notifications can reach any recipient too.
4. Retest with a second address.

## Fallback: Vercel

No code changes are needed.

1. Push the repository to GitHub ([guide 7](./07-publish.md)), then in Vercel choose **Add New > Project** and import it.
2. Set **Root Directory** to `apps/web`. The framework is detected as Next.js.
3. Add every variable from `.env.local` under **Environment Variables**, with `NEXT_PUBLIC_SITE_URL` set to the Vercel address (for example `https://auklet-yourname.vercel.app`; deploy once to learn it, then change it and redeploy).
4. Update the Supabase redirect URL and the Dodo webhook endpoint to the Vercel address, and put the new endpoint's signing key in `DODO_PAYMENTS_WEBHOOK_KEY`.

Vercel's free plan is for non-commercial use only, so keep Dodo in test mode there.

Next: [7. Publish](./07-publish.md)
