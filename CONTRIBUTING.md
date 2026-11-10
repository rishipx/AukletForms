# Contributing

Thanks for helping. Please open an issue before starting a large change.

## Set up

```bash
npm run install:all
npm test
```

Use the Node.js version in [`.nvmrc`](./.nvmrc). Database changes need Docker for `npx supabase test db`.

## Before you open a pull request

- `npm test` and `npm run typecheck` pass.
- `npm run format:check` passes (run `npm run format` to fix).
- New behavior has a test. Database changes have a pgTAP test in [`supabase/tests`](./supabase/tests).
- Schema changes are a **new migration** in `supabase/migrations`; never edit one that has been released.
- `apps/web/lib/security/secrets.ts` and `apps/worker/src/secrets.ts` must stay identical (a contract test enforces it), as must the plan limits and retention periods in TypeScript and SQL.
- No secrets, `.env*` files or personal paths in commits.

## Conventions

- TypeScript in strict mode; small modules with one responsibility; explanatory comments only where the code cannot say why.
- Errors returned to clients are RFC 7807 problem details.
- Every external call has a timeout, and background work in the Worker never rejects.
- Commit messages are short and imperative ("Add retention purge").

## Licensing

By contributing you agree that your contribution is licensed under the same terms as the code it changes: GPL-3.0-only for the repository, AGPL-3.0-only for `apps/selfhost-worker`.
