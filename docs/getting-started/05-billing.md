# 5. Billing with Dodo Payments (test mode)

Billing uses [Dodo Payments](https://dodopayments.com), a merchant of record, so it also handles customer-side sales tax and no card, upgrade or cancellation screen is built into the dashboard. Everything here stays in **test mode**, which needs no real money. How each webhook event changes an account is described in [Billing](../billing.md).

1. Sign up at <https://dodopayments.com> and make sure the dashboard's **Live Mode** switch is **off**.
2. **Products:** create two products of type **subscription**, billed **monthly** (any prices, for example Pro 9 and Agency 29). Copy both product ids (`pdt_...`).
3. **API key:** create an API key while in test mode.
4. Add to `apps/web/.env.local`:

   ```bash
   DODO_PAYMENTS_ENVIRONMENT=test_mode
   DODO_PAYMENTS_API_KEY=...
   DODO_PRODUCT_PRO=pdt_...
   DODO_PRODUCT_AGENCY=pdt_...
   DODO_PAYMENTS_WEBHOOK_KEY=whsec_...      # from step 6
   ```

5. Dodo cannot reach `localhost`, so start an HTTPS tunnel in a **second terminal** and keep it running:

   ```bash
   npx cloudflared tunnel --url http://localhost:3000     # prints https://something.trycloudflare.com
   # or: ngrok http 3000
   ```

   If `npx cloudflared` is unavailable on your machine, install `cloudflared` from <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/> or use ngrok.
6. In the Dodo dashboard open **Developer > Webhooks** and add an endpoint: `https://<your-tunnel-host>/api/webhooks/dodo`, subscribed to these events:

   `subscription.active`, `subscription.updated`, `subscription.renewed`, `subscription.plan_changed`, `subscription.on_hold`, `subscription.paused`, `subscription.unpaused`, `subscription.cancelled`, `subscription.expired`, `subscription.failed`

   Copy the endpoint's **signing key** into `DODO_PAYMENTS_WEBHOOK_KEY` and **restart `npm run dev`** (environment changes need a restart).
7. **Test it** at <http://localhost:3000/dashboard/settings>:
   - Click **Upgrade to Pro** and pay with one of Dodo's [test cards](https://docs.dodopayments.com/miscellaneous/testing-process).
   - **Expect:** you return to Settings and within a few seconds the plan shows **Pro** with a limit of **3,000**. The endpoint's delivery log in Dodo shows `200`, and the `profiles` row in Supabase shows `plan_tier = pro`.
   - Click **Manage Subscription & Invoices** to open the Dodo customer portal. If it offers plan changes, switch to Agency. **Expect:** the limit becomes **25,000**.
   - Cancel the subscription in the portal or the Dodo dashboard. **Expect:** the plan returns to Free with a limit of **250**. If you cancelled at period end and the plan stays on Pro, Dodo is scheduling the cancellation; see [cancellation timing](../billing.md#behaviors-to-confirm-in-test-mode).

If Dodo's dashboard labels differ from the ones above, follow Dodo's current docs at <https://docs.dodopayments.com>. The app only needs the API key, the two product ids and the webhook signing key.

Next: [6. Deploy the dashboard](./06-deploy-dashboard.md)
