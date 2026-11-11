# 3. Ingestion Worker

The ingestion Worker ([`apps/worker`](../../apps/worker)) is the public API at `POST /v1/f/:formId`.

## Email with Resend

1. In Resend, **API Keys > Create API Key** (sending access). Copy the `re_...` key.
2. For now, skip domain setup. Until you verify a domain, Resend only delivers mail sent from `onboarding@resend.dev` to **the email you signed up with**. That is fine for testing: use that address as the form's notification email in [guide 4](./04-dashboard-local.md).
3. To send to anyone later: **Domains > Add Domain**, add the DNS records Resend shows, then change `EMAIL_FROM` below to an address on that domain.

## Deploy

```bash
cd apps/worker
npx wrangler login                           # opens a browser
npx wrangler kv namespace create FORM_CACHE  # prints an id
```

Edit `wrangler.toml`:

```toml
[vars]
SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
EMAIL_FROM = "Auklet Forms <onboarding@resend.dev>"     # change after verifying a domain

[[kv_namespaces]]
binding = "FORM_CACHE"
id = "THE_ID_PRINTED_ABOVE"
```

Generate the key that encrypts forms' Turnstile secrets. **Save it somewhere safe and use the same value in the dashboard ([guide 4](./04-dashboard-local.md)).** If it is lost, saved Turnstile secrets cannot be recovered and must be entered again:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The same command works on macOS, Linux and Windows. (`openssl rand -base64 32` is equivalent if you have OpenSSL.)

Set the secrets (paste each value when prompted) and deploy:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # the Supabase secret / service_role key
npx wrangler secret put RESEND_API_KEY               # the re_... key
npx wrangler secret put TURNSTILE_ENC_KEY            # the base64 value generated above
npx wrangler deploy
```

**Expect:** the output lists a schedule (`17 3 * * *`) and prints a URL like `https://auklet-worker.YOUR-NAME.workers.dev`. Save the URL; it is your ingestion URL. The daily job deletes submissions older than each plan's history period and counts as database activity, which keeps a free Supabase project from pausing.

## Optional protections

Set these in `wrangler.toml` and redeploy:

- `EMAIL_DAILY_GLOBAL_CAP` (default 90) and `EMAIL_DAILY_FORM_CAP` (default 25) stop one form from using Resend's 100-emails-a-day free allowance. Over the cap, submissions are still saved and still sent to Slack and Discord; the dashboard shows "Email skipped".
- The `[[ratelimits]]` block (commented out) limits each visitor IP to 10 submissions a minute per form, before any database work. It needs Wrangler 4.36 or newer.

## Check that it works

```bash
WORKER=https://auklet-worker.YOUR-NAME.workers.dev

curl $WORKER/healthz
# {"ok":true}

curl -i -X POST $WORKER/v1/f/00000000-0000-4000-8000-000000000000 \
  -H 'Content-Type: application/json' -d '{"a":1}'
# HTTP 404 with "type":".../not-found"
```

On Windows PowerShell:

```powershell
$WORKER = "https://auklet-worker.YOUR-NAME.workers.dev"

curl.exe $WORKER/healthz
# {"ok":true}

try {
  Invoke-RestMethod -Method Post -Uri "$WORKER/v1/f/00000000-0000-4000-8000-000000000000" `
    -ContentType 'application/json' -Body '{"a":1}'
} catch { $_.Exception.Response.StatusCode.value__ }
# 404
```

The second call proves the Worker can read your database: **404 is correct** because that form does not exist. A **503** means the Worker cannot reach Supabase, so re-check `SUPABASE_URL` and the secret key. A **500 server-misconfigured** means a secret is missing. `npx wrangler tail` shows the logs.

Next: [4. Dashboard (local)](./04-dashboard-local.md)
