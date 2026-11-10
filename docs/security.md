# Security

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Protection against bots and abuse

**Built in**

- **Quota and caps:** a monthly submission limit per account, daily email caps (global and per form), and a 64 KiB size limit per submission.
- **Spam handling:** a honeypot field, flagging of submissions with four or more links (stored but never emailed), and optional Cloudflare Turnstile per form.
- **Database access:** Row Level Security on every table, a trigger so users cannot edit their own plan or quota, and the service key never reaches a browser.
- **Billing endpoints:** a same-origin check on checkout and portal routes, and signature-verified, replay-safe Dodo webhooks.
- **Webhook relays:** Slack and Discord targets are limited to the real Slack and Discord hosts, so the Worker cannot be used as a generic HTTP relay.

**Switch these on for production**

1. **Per-IP rate limit.** Uncomment the `[[ratelimits]]` block in `apps/worker/wrangler.toml` and redeploy. Without it, one IP can post to a form as fast as the Worker allows.
2. **Turnstile on every public form.** The form id is not secret, so without Turnstile anyone who learns a form's URL can use up its owner's quota.
3. **Captcha on login.** Supabase Authentication has a captcha setting that accepts Turnstile. It stops people flooding your login emails.
4. **A custom domain with Cloudflare's bot and WAF rules.** Most of those rules do not apply to `*.workers.dev` addresses. A domain is also required to send Resend email to other people.
5. **Uptime and usage alerts** (see [Operations](./operations.md#monitoring)). On the free tier a flood stops the service at the daily request limit rather than costing money.

## Secrets and personal data

- Only `*.example` templates are committed. `.env.local`, `.dev.vars` and build output are ignored by Git.
- Turnstile secret keys are stored AES-256-GCM encrypted. Backups are encrypted with your passphrase. Card details never touch this system: Dodo, as merchant of record, handles them.
- Users' email addresses and form submissions live in your Supabase database, so you are responsible for them. Users can delete their own account, which cascades to their forms and submissions.
- Before the first push, search tracked files for keys (see [Publish](./getting-started/07-publish.md)). If a secret is ever committed, rotate it immediately; removing it from history is not enough.
- Turn on two-factor authentication for GitHub, Cloudflare, Supabase, Resend and Dodo. Account takeover is a more realistic threat than a code flaw.
- Use a non-identifying Cloudflare account name: it becomes part of every `workers.dev` URL.
- Worker logs are structured JSON and never include submission contents or secrets. They may include request ids and form ids.
