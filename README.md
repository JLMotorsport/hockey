# Felixstowe HC Fantasy Hockey

A fantasy hockey league using only Felixstowe Hockey Club players, from every adult side (Men's 1s to 4s, Women's 1s to 3s).

- **Players** sign up, pick an 11 within a budget, choose a captain and make transfers each gameweek.
- **Managers** sync fixtures and scores from England Hockey, and enter who played, goals, assists, cards and player of the match.
- **League table** updates as soon as stats are entered for a gameweek whose deadline has passed.

Built the same way as ParkManager: a React app hosted on **Cloudflare**, with logins, the database and the scheduled sync on **Supabase**.

## What comes from England Hockey, and what doesn't

Each side's page on englandhockey.co.uk (e.g. `/teams/felixstowe-1-mens`) loads fixtures from a public feed. The `eh-sync` function uses it to bring in every league fixture (date, opponent, home or away) and final scores, so clean sheets, goals conceded and wins score automatically.

The feed does **not** include scorers, cards or line-ups, so managers enter those after each weekend. Cup games and friendlies can be added by hand.

If England Hockey change their site the sync may stop working. Everything else keeps working and fixtures can still be added by hand.

## Going live

You need a Supabase account and a Cloudflare account (the same ones as ParkManager are fine).

### 1. Supabase

1. Create a new project (e.g. `felixstowe-fantasy`), region London.
2. **SQL editor**: paste and run `supabase/migrations/0001_foundation.sql`, then `0002_game.sql`. Both are safe to run again.
3. **Authentication > Sign In / Providers > Email**: turn **Confirm email** off, unless you set up your own email sender (Supabase's built-in one only sends a few emails an hour, which a club sign-up rush will hit).
4. **Authentication > URL Configuration**: set Site URL to your Cloudflare address (step 2), and add it to Redirect URLs. Password reset links use this.
5. **Project Settings > API**: copy the Project URL and the anon/publishable key into `.env.production`, then commit. These are public by design; row-level security protects the data.

### 2. Cloudflare

1. **Workers & Pages > Create > Import a repository**, pick `JLMotorsport/hockey`.
2. Build command `npm run build`, deploy command `npx wrangler deploy` (it reads `wrangler.toml`).
3. Every push to `main` now deploys. Add a custom domain under the project's **Settings > Domains** if you want one.

### 3. England Hockey sync

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set EH_SYNC_SECRET=<any long random string>
npx supabase functions deploy eh-sync --no-verify-jwt --use-api
```

Managers can now press **Sync from England Hockey** in the app. To run it automatically on Sunday and Monday evenings, enable the `pg_cron` and `pg_net` extensions (Database > Extensions) and run this in the SQL editor:

```sql
select cron.schedule('ff-eh-sync', '0 20 * * 0,1', $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/eh-sync',
    headers := '{"Authorization":"Bearer <EH_SYNC_SECRET>"}'::jsonb
  );
$$);
```

### 4. Start the season

1. Open the site and **register first**: the first account becomes the league manager. Give others manager access from Manage > Users.
2. Press **Sync from England Hockey**. This loads fixtures and creates the gameweeks (one per weekend, deadline Saturday 10:00 UK time). Adjust in Manage > Deadlines.
3. **Manage > Players**: paste the squad, one per line: `Name, Position, Side, Price`, e.g. `Jo Bloggs, MID, M1, 8.5`. Positions are GK, DEF, MID, FWD. Sides are M1 to M4 and W1 to W3.
4. Share the link. After each weekend, sync for scores, then open each fixture under **Fixtures & stats** and tick who played and what they did. The overview lists results still waiting for stats.

## Game rules

Defaults, changeable in Manage > Settings: 11 players, 100.0m budget, max 4 from one side, 2 transfers per gameweek (the first squad is free). Squads carry over each week until changed, and other people's squads are hidden until the deadline.

| Event                     | Points                 |
| ------------------------- | ---------------------- |
| Playing                   | 1                      |
| Goal                      | GK/DEF 6, MID 5, FWD 4 |
| Assist                    | 3                      |
| Clean sheet               | GK/DEF 4, MID 1        |
| Every 2 goals conceded    | GK/DEF -1              |
| Team win                  | 2                      |
| Player of the match       | 3                      |
| Green / yellow / red card | -1 / -2 / -4           |
| Captain                   | x2                     |

A player who turns out for a different Felixstowe side that weekend scores for both games.

## Developing

Needs Node 20+ and Docker (for the local Supabase).

```bash
npm install
npx supabase start
npx supabase db reset                 # applies migrations
cp .env.example .env.local            # fill from `npx supabase status`
npm run dev                           # http://localhost:5173
```

Without Supabase settings the app shows a setup screen instead of crashing.

| Command                    | What                                                     |
| -------------------------- | -------------------------------------------------------- |
| `npm run dev`              | Dev server                                               |
| `npm run build`            | Typecheck + production build                             |
| `npm run lint`             | ESLint + Prettier check                                  |
| `npm run test:unit`        | Unit tests (scoring, squad rules, England Hockey parser) |
| `npm run test:integration` | Database rules against local Supabase (see CLAUDE.md)    |
| `npm run gen:types`        | Regenerate `src/types/database.ts`                       |

## Layout

```
src/lib/                 scoring, squad rules, formatting, data hooks, auth
src/features/            screens: auth, league, squad, admin (manager dashboard)
supabase/migrations/     tables, row-level security, game logic (the real rules)
supabase/functions/      eh-sync Edge Function + shared England Hockey parser
tests/unit/              vitest
tests/integration/       vitest against local Supabase
wrangler.toml            Cloudflare static-assets config
```
