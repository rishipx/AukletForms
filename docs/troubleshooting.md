# Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `supabase test db` fails | Read the failing assertion's name and the error. Make sure Docker is running and you ran `db reset` first. |
| Magic link never arrives | Built-in email limit: wait and retry. Check spam. Confirm Email is enabled in Supabase Auth. |
| Link opens but returns to login with an error | Open it in the same browser you requested it from; confirm the redirect URL is listed in Supabase. |
| Worker returns **503** | Cannot reach Supabase: wrong `SUPABASE_URL` / secret key, or the project is paused. |
| Worker returns **500 server-misconfigured** | A secret or var is missing. `npx wrangler tail` shows which. |
| Submission returns **403 origin-not-allowed** | The page's domain is not in the form's Allowed domains. Changes take up to 60 seconds to apply. |
| Submission works but **no email** | In sandbox mode the notification email must equal your Resend signup email. `npx wrangler tail` shows Resend's error; the Resend dashboard shows its logs. Free plan: 100 emails per day. |
| **429 quota-exceeded** | The free plan allows 250 per month. Check `profiles.current_cycle_usage`, or upgrade through Dodo Payments. |
| Submissions tab says **Offline** | Realtime is not delivering: confirm `submissions` is in the `supabase_realtime` publication ([Database](./getting-started/02-database.md)). |
| Dodo webhook returns **401 invalid signature** | Wrong `DODO_PAYMENTS_WEBHOOK_KEY`. Each endpoint (tunnel and deployed) has its own signing key. Restart the server after changing it. |
| "Billing is not configured" | `DODO_PAYMENTS_API_KEY` or the product ids are missing, or the server was not restarted. |
| "Manage Subscription" or checkout errors | A test-mode key used with `DODO_PAYMENTS_ENVIRONMENT=live_mode` (or the reverse) is rejected. Keep them matching. Check the server log for the Dodo status code. |
| Plan does not change after paying | The webhook did not arrive or failed. Check that the tunnel is running and the endpoint URL is current (free tunnels change URL on restart), then the endpoint's delivery log in Dodo. A `500` with "unknown product" in the server log means `DODO_PRODUCT_*` does not match the product that was bought. |
| Dashboard will not start: "Invalid environment" | The message lists exactly what is missing or malformed (for example half-configured billing, or a `TURNSTILE_ENC_KEY` that is not base64 of 32 bytes). Fix and restart. |
| Turnstile form returns **503** | The Worker cannot decrypt the stored secret: `TURNSTILE_ENC_KEY` is missing or differs from the dashboard's. Set the same value on both. |
| Saving a form with Turnstile says the key is not set | Set `TURNSTILE_ENC_KEY` for the dashboard ([Dashboard](./getting-started/04-dashboard-local.md)) and restart. |
| Submission shows **Email skipped** | The daily email cap was reached. Raise `EMAIL_DAILY_FORM_CAP` / `EMAIL_DAILY_GLOBAL_CAP` if your Resend plan allows it. |
| Submission shows **Email failed** | Resend rejected it: check `npx wrangler tail` and Resend's logs (sandbox recipient rule, invalid sender). |
| Submission shows **Spam** but was real | It contained four or more links. It is saved in the dashboard; ask the sender to resend without links, or raise `SPAM_LINK_THRESHOLD` in `apps/worker/src/spam.ts`. |
| **413 submission-too-large** | The text fields add up to more than 64 KiB. File contents are never stored. |
| Dashboard shows the wrong address or Supabase errors after a Cloudflare deploy | `NEXT_PUBLIC_*` values are baked in at build time. Fix them in `.env.local` and run `npm run cf:deploy` again. (On Vercel: add them before the build and redeploy.) |
| Dashboard pages return **Error 1102** or "exceeded CPU" | The free 10 ms CPU limit. Use the [Vercel fallback](./getting-started/06-deploy-dashboard.md#fallback-vercel) or Cloudflare's paid Workers plan. |
| Supabase says project paused | Free projects pause after a week of inactivity. Click **Restore** in the dashboard. |
