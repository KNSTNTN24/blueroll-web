@AGENTS.md

# Notes for Claude

- Start every task by reading the matching page in `docs/domain/` (index: `docs/domain/README.md`). Verify facts
  against the code on `main` and, for anything about data or permissions, the live database — not memory.
- Live database (read-only checks): Supabase Management API `POST /v1/projects/rszrggreuarvodcqeqrj/database/query`
  with the access token from `~/Secrets/blueroll/supabase-access-token.txt`. Never print tokens or keys; never
  write to prod without the user's explicit go-ahead.
- Before a PR: `npm test`, `npm run build`; for edge functions also `deno check`. Update the domain page you touched.
- Don't use `git stash` in this repo's worktrees for baseline checks — the stash list is shared across worktrees.
- Old work log (Russian, April–July 2026): `docs/history.md`. Outdated overviews `docs/01-DESIGN.md`–`04-DATABASE.md`
  are superseded by `docs/domain/`.
