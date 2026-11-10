# 2. Database

The schema lives in [`supabase/migrations`](../../supabase/migrations) and is covered by pgTAP tests in [`supabase/tests`](../../supabase/tests).

## Run the database tests locally

```bash
npx supabase start         # first run downloads Docker images (a few minutes)
npx supabase db reset      # applies the 3 migrations
npx supabase test db       # runs the 4 pgTAP files
npx supabase stop
```

**Expect:** `db reset` finishes without errors and `test db` ends with `Result: PASS` (51 assertions across `access_control`, `quota`, `billing_events` and `operations`). A failing assertion names itself, so the failing line tells you what broke.

## Create the hosted database

1. In Supabase click **New project**. Choose a region near you and a strong database password (save it).
2. Wait until the project is ready, then copy the **project reference** (the `abcdefgh` part of `https://abcdefgh.supabase.co`).
3. Apply the migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF     # asks for the database password
   npx supabase db push
   ```

   **Expect:** it lists the 3 migrations and applies them.
4. Check in the Supabase dashboard: **Table Editor** shows `profiles`, `forms`, `submissions`, `billing_events` and `email_counters`. **Database > Publications** shows `submissions` under `supabase_realtime`.
5. **Authentication > URL Configuration:** set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/auth/callback` under **Redirect URLs**. You add your deployed dashboard address in [guide 6](./06-deploy-dashboard.md).
6. **Authentication > Sign In / Providers:** Email must be enabled (it is by default).
7. Copy your keys from **Project Settings > API Keys** into a scratch note:
   - **Project URL**
   - **Publishable key** (`sb_publishable_...`) or the legacy **anon** key (`eyJ...`). Safe for the browser.
   - **Secret key** (`sb_secret_...`) or the legacy **service_role** key. **Server-side only. Never put it in a `NEXT_PUBLIC_` variable and never commit it.**

## Login emails

Supabase's built-in email sender allows only a few messages per hour. That is enough for you alone but fails as soon as a few people try the product. Once you have a Resend API key ([guide 3](./03-ingestion-worker.md)), send login mail through Resend instead:

**Authentication > SMTP Settings > Enable custom SMTP** with host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, and sender `onboarding@resend.dev` (or an address on your own domain). Check Resend's SMTP page if any of these have changed.

Until you verify a domain in Resend it delivers only to the address you signed up with, so only that person can sign in. To let anyone else try the product, verify a domain first.

Next: [3. Ingestion Worker](./03-ingestion-worker.md)
