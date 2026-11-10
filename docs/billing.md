# Billing

Payments are handled entirely by [Dodo Payments](https://dodopayments.com) checkout and its customer portal. Dodo is the merchant of record, so it also handles customer-side sales tax. No card, upgrade or cancellation UI is built into the dashboard.

Setup steps are in [Getting started: Billing](./getting-started/05-billing.md). Code: [`apps/web/lib/billing`](../apps/web/lib/billing) and [`apps/web/app/api`](../apps/web/app/api).

## Plans

| Plan | Submissions per month | History kept |
| --- | --- | --- |
| Free | 250 | 30 days |
| Pro | 3,000 | 90 days |
| Agency | 25,000 | 365 days |

The Dodo **product id** decides the plan. The numbers live in [`plans.ts`](../apps/web/lib/billing/plans.ts) and in the database; a contract test keeps them equal.

## Webhook handling

| Event | Effect |
| --- | --- |
| `subscription.active` | Links the Dodo customer and subscription to the user and sets the plan. A **new** subscription starts a fresh quota window ending at `next_billing_date`; re-activating the same one (after `on_hold`) keeps current usage |
| `subscription.renewed` | `current_cycle_usage = 0`, `cycle_resets_at` = next billing date |
| `subscription.plan_changed`, `subscription.updated` | Sync Pro/Agency changes made in the portal. Usage is **not** reset, so switching plans cannot be used to gain quota |
| `subscription.on_hold`, `subscription.paused` | Free limits apply; the subscription stays on file so `active` or `unpaused` restores it |
| `subscription.unpaused` | Restores the plan |
| `subscription.cancelled`, `subscription.expired`, `subscription.failed` | Reverts to Free and clears the subscription id; the customer id is kept for invoices |
| anything else, including `subscription.past_due` | Acknowledged and ignored (`past_due` is a grace period, so access continues) |

Delivery rules the code relies on:

- Every webhook is claimed once by its `webhook-id` header, so retries and duplicates are acknowledged without being applied twice.
- Dodo makes **no ordering guarantee**, so each profile stores the timestamp of the newest event applied (`billing_updated_at`) and older events are ignored.
- Every write is absolute ("set plan to pro"), never relative, so replays are harmless.
- If processing fails the claim is released and the endpoint answers 5xx, so Dodo retries.
- A webhook is matched to a user by the `user_id` metadata that checkout sends, then by the Dodo customer id, then by billing email (only if it matches exactly one account).

## Behaviors to confirm in test mode

The Dodo documentation does not state these, so verify them once with a test subscription:

- **Cancellation timing.** The app treats `subscription.cancelled` as "access ends now". If Dodo sends it when a user schedules a cancellation at period end, they would lose the rest of the paid period. If you see that, change `end()` in `apps/web/lib/billing/handlers.ts` to wait for `subscription.expired` when the payload still shows `status: "active"`.
- **Metadata.** Checkout sends `user_id` as metadata. If Dodo does not copy it into subscription webhooks, the handler falls back to the customer id and then to the billing email, so linking still works.

## Testing locally

Dodo cannot reach `localhost`. Expose the dev server through an HTTPS tunnel (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and use `https://<tunnel-host>/api/webhooks/dodo` as the endpoint URL, then upgrade from `/dashboard/settings` with one of Dodo's test cards. Keep `DODO_PAYMENTS_ENVIRONMENT=test_mode`: test keys only work in test mode and live keys only in live mode.
