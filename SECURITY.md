# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's "Report a vulnerability" button (Security tab) on this repository. Include what you found, how to reproduce it and the impact. You can expect an acknowledgement within a few days.

## Scope

In scope: the ingestion Worker, the dashboard, the database schema and policies, and the self-host Worker.

Out of scope: findings that require a compromised account or device, denial of service by raw traffic volume, and issues in third-party services (Cloudflare, Supabase, Resend, Dodo Payments).

Operational guidance for deployers is in [docs/security.md](./docs/security.md).
