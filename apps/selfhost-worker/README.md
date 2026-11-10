# Auklet Forms (self-hosted)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rishipx/AukletForms/tree/main/apps/selfhost-worker)

**A form endpoint for your website that fits in one file.** Point any HTML form or `fetch()` call at your own Cloudflare Worker and every submission lands in your inbox. No backend, no database, no framework, no dependencies.

- **One file**: [`src/index.ts`](./src/index.ts), under 600 lines, runs on Cloudflare's edge.
- **Spam trap built in**: hidden `_gotcha` / `_botcheck` / `_honeypot` fields silently drop bots.
- **CORS allow-list**: only your websites can submit from a browser.
- **Reliable by design**: it waits for Resend to accept the email and tells the visitor if it could not, instead of losing the message silently.
- **Works with plain HTML forms and JavaScript**: JSON, `multipart/form-data` and `application/x-www-form-urlencoded`.

> Want submissions stored in a dashboard and relayed to Slack or Discord, with bot protection and zero DNS setup? That is [Auklet Cloud](https://auklet.dev). See [the comparison](#self-hosted-vs-auklet-cloud).

---

## Quick start (about 5 minutes)

**1. Get a Resend API key.** Create a free account at [resend.com](https://resend.com), then create an API key under *API Keys*.

**2. Click the button.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rishipx/AukletForms/tree/main/apps/selfhost-worker)

Cloudflare copies this project into your own GitHub account, asks for the two required values, and deploys it:

| Prompt | Enter |
| --- | --- |
| `RESEND_API_KEY` | The key from step 1 (starts with `re_`) |
| `TO_EMAIL` | Where submissions should be delivered |

**3. Copy your endpoint.** After deploying, Cloudflare shows your Worker's URL, like `https://auklet-forms.your-name.workers.dev`.

**4. Send a test.**

```bash
curl -X POST https://auklet-forms.your-name.workers.dev \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","message":"Hello!"}'
# {"success":true,"id":"..."}
```

> **Testing before you verify a domain:** the default sender (`onboarding@resend.dev`) is Resend's sandbox. It only delivers to the email address you signed up to Resend with, so set `TO_EMAIL` to that address while testing. To send to anyone, [verify a domain in Resend](https://resend.com/domains) and set `FROM_EMAIL` to an address on it.

## Add it to your site

**Plain HTML**, no JavaScript needed:

```html
<form action="https://auklet-forms.your-name.workers.dev" method="POST">
  <input type="text" name="name" placeholder="Name" required>
  <input type="email" name="email" placeholder="Email" required>
  <textarea name="message" placeholder="Message" required></textarea>

  <!-- Spam trap: invisible to people, irresistible to bots. Keep the name. -->
  <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true"
         style="position:absolute;left:-9999px">

  <button type="submit">Send</button>
</form>
```

Visitors are redirected to `REDIRECT_URL` afterwards, or to the built-in `/thanks` page.

**JavaScript / React / Next.js**:

```ts
const res = await fetch('https://auklet-forms.your-name.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(Object.fromEntries(new FormData(form))),
});

if (res.ok) {
  // { success: true, id: "..." }
} else {
  const problem = await res.json(); // RFC 7807: { type, title, status, detail }
  showError(problem.detail);
}
```

Any field named `email` becomes the email's **Reply-To**, so you can answer visitors with one click.

## Configuration

Set variables in [`wrangler.toml`](./wrangler.toml) under `[vars]`, or in the Cloudflare dashboard (*Workers & Pages > your Worker > Settings > Variables*). Secrets use `npx wrangler secret put NAME`.

| Name | Required | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes (secret) | Resend API key. |
| `TO_EMAIL` | Yes (secret) | Recipient. One address, or up to 10 separated by commas. |
| `FROM_EMAIL` | No | Sender, e.g. `Website <forms@yourdomain.com>`. Must be on a domain verified in Resend. Default: Resend's sandbox sender. |
| `ALLOWED_ORIGINS` | No, **set it for production** | Sites allowed to submit from a browser, comma-separated: `yourdomain.com, *.yourdomain.com, localhost:3000`. Empty or `*` accepts any site. |
| `REDIRECT_URL` | No | Where plain HTML form posts land afterwards. Default: built-in `/thanks` page. |
| `SUBJECT` | No | Email subject. Default: `New form submission`. |
| `RATE_LIMITER` | No | Optional per-IP limiter binding. See below. |

`ALLOWED_ORIGINS` matching rules: hosts match exactly (http and https), ports must match (`localhost:3000` is not `localhost:4000`), and `*.yourdomain.com` matches subdomains but not `yourdomain.com` itself.

## Harden it

This endpoint is public and every accepted submission sends an email, so a few minutes here is worth it.

1. **Set `ALLOWED_ORIGINS`** to your own sites. Browsers on other sites are then refused.
   CORS only constrains browsers: someone using `curl` can still post, so also do steps 2 and 3.
2. **Turn on the rate limiter.** In `wrangler.toml`, uncomment the `[[ratelimits]]` block and redeploy. It allows 10 submissions per IP per minute by default (the period must be 10 or 60 seconds). Requires Wrangler 4.36 or newer. Counts are kept per Cloudflare location and are approximate, which is plenty for stopping floods.
3. **Add a Cloudflare rate-limiting rule** on your zone if the Worker sits on your own domain (*Security > WAF > Rate limiting rules*). It stops abusive traffic before it reaches the Worker.
4. **Keep the honeypot field** in every form.
5. **Mind Resend's limits.** Resend's default API limit is 10 requests per second per team, and your plan has its own sending quota. A flood that gets past the steps above can use them up.

## Run it from the command line

```bash
git clone https://github.com/rishipx/AukletForms && cd AukletForms/apps/selfhost-worker
npm install

# local development
cp .dev.vars.example .dev.vars        # then fill in RESEND_API_KEY and TO_EMAIL
npm run dev                           # http://localhost:8787

# tests and type checks
npm test && npm run typecheck

# deploy to your Cloudflare account
npx wrangler login
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TO_EMAIL
npm run deploy
```

## How it behaves

| Situation | Response |
| --- | --- |
| Success, and the client wants JSON (`Accept: application/json`, a JSON body, or `fetch()`) | `200 {"success":true,"id":"..."}` |
| Success from a plain HTML form post | `302` to `REDIRECT_URL` or `/thanks` |
| Honeypot filled in | Same success response as above. **No email is sent**, and the bot cannot tell. |
| Origin not allowed | `403` |
| Unsupported content type / bad body / empty submission / body over 1 MiB | `415` / `400` / `400` / `413` |
| Rate limited | `429` with `Retry-After` |
| Resend unreachable or rejecting the email | `502` (retried once first) |
| Missing or invalid settings | `500`. The reason is written to the Worker logs, not shown to visitors. |

Every error is an [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) `application/problem+json` document with a stable `type`, for example `https://auklet.dev/problems/origin-not-allowed`.

Uploaded files are **not** stored or attached; the email notes that a file was sent. Submission contents are never written to logs.

## What this edition does not do

Being a single file with no database, it deliberately leaves these out:

- **No stored submissions.** Email is the only record. If it bounces or is deleted, the message is gone.
- **No Slack or Discord relays**, and no dashboard or CSV export.
- **No Cloudflare Turnstile verification.** Spam defense is the honeypot, the origin allow-list and the optional rate limiter.
- **One recipient configuration per deployment.** For several sites with different recipients, deploy one Worker per site.
- **No usage quotas or billing.**

If you need those, that is what Auklet Cloud is for.

## Self-hosted vs Auklet Cloud

| | **Self-hosted** (this repo) | **[Auklet Cloud](https://auklet.dev)** |
| --- | --- | --- |
| Setup | Deploy the Worker, create a Resend account, set secrets | Sign up, create a form, paste the endpoint |
| DNS and email domain | You verify a sending domain in Resend (SPF and DKIM records) to send from your own address | **Zero DNS setup.** Nothing to verify or configure |
| Email deliverability | Your own domain's reputation. A new domain needs time to warm up | **No warm-up.** Sent from Auklet's already established sending domain |
| Several sites or clients | One Worker and one recipient setup per site | **Multi-tenant dashboard.** Manage every form, recipient and allowed domain in one place, which suits agencies |
| Bot protection | Honeypot field, origin allow-list, optional per-IP rate limit | Honeypot **plus Cloudflare Turnstile verification**, configured per form from the dashboard |
| Notifications | Email | Email, **Slack and Discord relays** |
| Submission history | None (email only) | Stored log with live updates, spam flags and CSV export |
| Usage limits | Whatever your Cloudflare and Resend plans allow | Free plan with 250 submissions per month, paid plans for more |
| Hosting and upkeep | You run and update it | We run it |
| Cost | Free software, you pay your own Cloudflare and Resend usage | Free plan, then subscription |
| Source | AGPL-3.0 | Hosted service |

Self-hosting is a perfectly good choice for one personal site. Auklet Cloud saves the setup and upkeep once you have more than one form, more than one client, or want a record of what came in. [Start free at auklet.dev](https://auklet.dev). Nothing here locks you in: Auklet Cloud endpoints use the same paths and request format (`POST /v1/f/<id>`), so switching in either direction means changing one URL.

## Contributing

Issues and pull requests are welcome. Please run `npm test && npm run typecheck` first.

## License

[GNU Affero General Public License v3.0](./LICENSE). You can use, modify and self-host this freely. The AGPL's section 13 asks that if you modify it and offer the modified version to users over a network, you also make your modified source available to them. See the license text for the exact terms.
