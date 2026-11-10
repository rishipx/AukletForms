# 7. Publish the repository

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/rishipx/AukletForms.git
git push -u origin main
```

Before the first push, check that `git status` never lists `.env.local` or `.dev.vars` (both are ignored) and run `git grep -nE "sb_secret_[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{30,}"` to confirm no key is in a tracked file.

## Repository links

The README of the open-source edition links to `github.com/rishipx/AukletForms`. If you publish under a different owner or name, update those links:

```bash
sed -i "s#rishipx/AukletForms#NEW-OWNER/NEW-NAME#g" apps/selfhost-worker/README.md
```

(On macOS use `sed -i ''`.)

## Continuous integration

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every push and pull request: both Workers, the dashboard (tests, build, typecheck), the database tests on a real Supabase stack, and the end-to-end smoke test of the ingestion Worker in the Workers runtime. [Dependabot](../../.github/dependabot.yml) opens weekly dependency updates.

[`.github/workflows/backup.yml`](../../.github/workflows/backup.yml) takes a weekly encrypted database backup. It needs two repository secrets; see [Operations](../operations.md#backups).

## Publish the open-source edition

[`apps/selfhost-worker`](../../apps/selfhost-worker) is a separate, self-contained product (AGPL-3.0) with its own README and a **Deploy to Cloudflare** button. The button needs a **public** GitHub repository.

- **Option A: make this whole repository public.** The button URL already points at `/tree/main/apps/selfhost-worker`.
- **Option B: a separate public repository** containing only the contents of `apps/selfhost-worker`. In its README change the button link to `https://deploy.workers.cloudflare.com/?url=https://github.com/YOU/REPO` (no `/tree/...`) and fix the `git clone` line.

Test the button from a Cloudflare account that has never seen the project: click it, enter a Resend key and your email, deploy, then `curl` the new URL as in [guide 3](./03-ingestion-worker.md).

Back to the [documentation index](../README.md).
