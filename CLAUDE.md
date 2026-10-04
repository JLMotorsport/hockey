# Felixstowe HC Fantasy Hockey

Fantasy hockey league for Felixstowe Hockey Club. Same stack and deploy flow as ParkManager:
React + Vite + TypeScript + Tailwind SPA on Cloudflare, backed by Supabase (Postgres, Auth,
RLS, Edge Functions).

## Rules

- The database is the real boundary. Squad rules, deadlines, hidden squads and manager-only
  actions are enforced in `supabase/migrations` (RLS + RPCs); the UI only mirrors them.
- Points rules live in two places that must agree: `performance_points()` in
  `supabase/migrations/0002_game.sql` and `src/lib/scoring.ts`. The integration tests check parity.
- No em dashes in any user-facing copy.
- 44px minimum touch targets for anything people tap on a phone.

## Commands

| Task          | Command                                                 |
| ------------- | ------------------------------------------------------- |
| Dev server    | `npm run dev`                                           |
| Typecheck     | `npm run typecheck`                                     |
| Lint + format | `npm run lint` (fix: `npm run lint:fix`)                |
| Unit tests    | `npm run test:unit`                                     |
| Integration   | `npx supabase db reset` then `npm run test:integration` |
| Build         | `npm run build`                                         |
| DB types      | `npm run gen:types` (after changing a migration)        |

Integration tests need `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and
`SUPABASE_TEST_SERVICE_ROLE` from `npx supabase status -o env` (see `.github/workflows/ci.yml`).

## Deploying

| What               | How it reaches production                                                  |
| ------------------ | -------------------------------------------------------------------------- |
| Frontend (the app) | **`git push` to `main`. Cloudflare builds automatically.**                 |
| Migrations (SQL)   | Applied by hand: paste the migration into the Supabase SQL editor          |
| Edge function      | GitHub Actions (`deploy-functions.yml`) on push to `main`, or Run workflow |

- Do not tell the user to run `npx wrangler deploy` for a frontend change; the push does it.
- Migrations are pasted by hand, so write them to be re-runnable: `if not exists`,
  `create or replace`, `drop policy if exists`. After adding one, give the user the SQL to paste
  and say plainly it must be run before the feature works.

## Data from England Hockey

`supabase/functions/eh-sync` reads each side's englandhockey.co.uk team page for the feed URL and
public key, imports fixtures and scores via `import_fixtures()`, then reads each played fixture's
feed (`/api/fixtures/<id>`) for line-ups, goals (FG/PC/PS) and cards (GC/YC/RC) and imports them
via `import_lineup()`. Players are matched by England Hockey member id (or by name, once, for
players a manager added by hand). Assists, player of the match and outfield positions are not
published. The sync only writes goals and cards for players with an England Hockey id; manual rows
(withheld names), assists and player of the match are kept. `stats_locked` stops the sync for a match.
The parser in `supabase/functions/_shared/ehFixtures.ts` is pure TS, shared with vitest.
