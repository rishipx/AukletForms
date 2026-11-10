# Database

PostgreSQL schema for Supabase, applied with the Supabase CLI.

## Migrations

| File | Contents |
| --- | --- |
| [`20261030000000_core_schema.sql`](./migrations/20261030000000_core_schema.sql) | `profiles`, `forms`, `submissions`; auth-to-profile sync; Row Level Security; the privilege-escalation guard; table grants; Realtime publication |
| [`20261030000100_quota_and_billing.sql`](./migrations/20261030000100_quota_and_billing.sql) | `consume_submission_quota()` (atomic, with cycle rollover); `billing_events` webhook claims |
| [`20261030000200_operations.sql`](./migrations/20261030000200_operations.sql) | `email_counters` and `consume_email_slot()`; `purge_old_data()` retention |

## Trust model

| Role | Access |
| --- | --- |
| `authenticated` (dashboard users) | Restricted by RLS to their own rows. Cannot change plan, quota or billing columns (a trigger enforces this) |
| `service_role` (Worker, webhooks) | Server-side only. Bypasses RLS. Sole writer of submissions, quota and billing state |
| `anon` | No table access |

## Tests

[`tests/`](./tests) holds pgTAP tests (51 assertions in 4 files). They run against a local Supabase stack:

```bash
npx supabase start
npx supabase db reset     # applies the migrations
npx supabase test db
```

`config.toml` is the Supabase CLI configuration for the local stack (ports, auth URLs).
