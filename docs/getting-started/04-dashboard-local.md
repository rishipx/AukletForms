# 4. Dashboard (local) and the first end-to-end test

```bash
cd apps/web
cp .env.example .env.local          # PowerShell: Copy-Item .env.example .env.local
```

Fill in `.env.local` (leave the Dodo lines for [guide 5](./05-billing.md)):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable or anon key>
NEXT_PUBLIC_INGEST_URL=https://auklet-worker.YOUR-NAME.workers.dev
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<secret / service_role key>
TURNSTILE_ENC_KEY=<the same base64 value you gave the Worker>
```

```bash
npm run dev
```

The dashboard validates its environment at startup and prints exactly what is missing or malformed. Every variable is described in the [configuration reference](../configuration.md).

## Walk through the product

Open <http://localhost:3000>:

1. **Sign in.** Enter your email, click **Send Magic Link**, open the email and click the link **in the same browser**. **Expect:** the dashboard with "Create your first form".
2. **Create a form.** Click **Create New Form** and name it anything. For **Notification email** use **the email you signed up to Resend with**. Leave Allowed domains empty. **Expect:** the form page opens on the Integration tab with your endpoint and snippets.
3. **Send a submission.** On the form's **Integration** tab, copy the **curl** snippet (macOS, Linux) or the **PowerShell** snippet (Windows) and run it. **Expect:** `{"success":true,"id":"..."}`.
4. **Check the three results:**
   - an email arrives (check spam). Its Reply-To is the `email` field you sent;
   - the **Submissions** tab shows the row **without refreshing**, with a green **Live** dot;
   - clicking the row opens a side panel with the raw JSON, your IP and your user agent.
5. **Try the safety features:**
   - **Honeypot:** add `"_gotcha":"x"` to the curl JSON. You still get `success`, but no email and no new row.
   - **Allowed domains:** in **Settings**, add `example.com`, save, wait about a minute, then repeat the curl with `-H 'Origin: https://evil.io'`. **Expect:** `403 origin-not-allowed`.
   - **Link spam:** send a message containing four or more links. **Expect:** `success`, no email, and the row appears with a red **Spam** badge.
   - **CSV:** click **Export to CSV**.
6. **Check quota.** The header meter shows `1 / 250` (refresh the page).

If step 1 fails with "invalid or expired link", open the link in the browser you requested it from and confirm the redirect URL from [guide 2](./02-database.md).

## Optional: API-level smoke test

[`scripts/smoke.mjs`](../../scripts/smoke.mjs) runs 11 end-to-end checks against a running ingestion Worker. With no accounts at all, use the bundled mock of the Supabase API:

```bash
node scripts/mock-supabase.mjs &
(cd apps/worker && npx wrangler dev --var SUPABASE_URL:http://127.0.0.1:54399 \
  --var SUPABASE_SERVICE_ROLE_KEY:sb_secret_local --var RESEND_API_KEY:re_fake) &
node scripts/smoke.mjs
```

To point it at your real project instead, set `WORKER_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it creates and deletes a throwaway user.

Next: [5. Billing](./05-billing.md)
