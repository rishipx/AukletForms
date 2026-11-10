# Operations

Free-tier projects stop working quietly in a few predictable ways. Each has a protection built into the repository.

| Risk | Protection | What you do |
| --- | --- | --- |
| Supabase pauses a project after a week without activity | The Worker's daily cron job | A week after deploying, check that **Workers & Pages > auklet-worker > Settings > Triggers** shows the cron and the logs contain `maintenance finished` |
| The free Supabase plan has **no backups** | Weekly encrypted dump (`backup.yml`), kept 30 days | Add the two repository secrets, run the workflow once, and download the artifact to confirm it works |
| Resend's 100 emails a day are shared by everyone | Per-form and global daily caps | Nothing; watch for "Email skipped" badges |
| Supabase's 500 MB database fills with submissions | Daily retention purge (30, 90 or 365 days by plan) and a 64 KiB cap per submission | Nothing |
| A form is flooded by bots | Honeypot, link-spam flag, optional Turnstile, optional per-IP rate limit | Enable the rate limit ([Security](./security.md)) |
| A bad deploy or missing secret | The dashboard refuses to start with an invalid environment and names the problem; the smoke test runs in CI | Read the deploy log |
| You are not told when it is down | Nothing built in | Create a free uptime monitor (UptimeRobot or Better Stack) for `https://YOUR-WORKER/healthz` and your dashboard URL |

## Backups

[`.github/workflows/backup.yml`](../.github/workflows/backup.yml) runs every Sunday and on demand. Add these repository secrets (**Settings > Secrets and variables > Actions**):

- `SUPABASE_DB_URL`: the **Session pooler** connection string from Project Settings > Database. The direct host is IPv6-only and GitHub runners cannot reach it.
- `BACKUP_PASSPHRASE`: any long random string. Keep a copy somewhere safe; without it a backup cannot be opened.

Run **Actions > Database backup > Run workflow** once and download the artifact. GitHub switches scheduled workflows off after 60 days without repository activity, so re-enable it under **Actions** if it stops.

## Restoring from a backup

Practise this once on a scratch Supabase project, not during an emergency.

1. Decrypt (it asks for `BACKUP_PASSPHRASE`):

   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in auklet-backup-YYYYMMDD.tar.enc | tar -xf -
   ```

   You get `auth.sql` (login accounts) and `public.dump` (your data).
2. On a **new, empty** Supabase project, load the accounts first, then your data, using the project's session-pooler connection string:

   ```bash
   psql "$NEW_DB_URL" -f auth.sql
   pg_restore --no-owner --dbname "$NEW_DB_URL" public.dump     # "schema public already exists" is harmless
   ```

3. Re-create the two sign-up triggers, which live on `auth.users` and are not part of the data dump. Copy the `CREATE TRIGGER on_auth_user_created ...` and `CREATE TRIGGER on_auth_user_email_changed ...` statements from [`supabase/migrations/20261030000000_core_schema.sql`](../supabase/migrations/20261030000000_core_schema.sql) into the SQL editor and run them.
4. Point `SUPABASE_URL`, the keys and the dashboard variables at the new project, and update the Supabase auth redirect URLs.

## Monitoring

- **Logs:** Workers Logs are enabled for both Workers (`npx wrangler tail` for a live view). Entries are JSON with `level`, `message` and context fields.
- **Health:** `GET /healthz` on the ingestion Worker returns `{"ok":true}`.
- **Usage:** watch request counts in the Cloudflare dashboard against the free daily limit.

## Free-tier limits

| Service | Limit | What the repository does about it |
| --- | --- | --- |
| Resend | 100 emails a day, and only your own address until a domain is verified | Daily email caps; submissions are still stored and sent to Slack and Discord |
| Supabase | Pauses after a week of inactivity; no backups; 500 MB database; built-in login mail is rate-limited | Daily cron, weekly encrypted backup, retention purge, Resend SMTP |
| Cloudflare Workers | 100,000 requests a day, 10 ms CPU per request, 50 subrequests | Cheap checks first; optional per-IP rate limit |
| Cloudflare KV | 1,000 writes a day | Config is cached in memory in front of KV; writes happen only on a cache miss |
| Vercel Hobby (fallback only) | Non-commercial use; 100,000 function invocations and 100 GB bandwidth a month | Cloudflare is the default host |
| GitHub Actions | Scheduled workflows are disabled after 60 days without repository activity | Re-enable the backup workflow if it stops |

Limits come from the providers' pricing pages and change; check them if something starts failing.
