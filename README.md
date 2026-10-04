# Felixstowe HC Fantasy Hockey

A fantasy hockey league using only Felixstowe Hockey Club players, from every adult side (Men's 1s to 4s, Women's 1s to 3s).

- **Players** sign up, pick an 11 within a budget, choose a captain and make transfers each gameweek.
- **Managers** sync fixtures and scores from England Hockey, and enter who played, goals, assists, cards and player of the match.
- **League table** updates as soon as stats are entered for a gameweek whose deadline has passed.

Built the same way as ParkManager: a React app hosted on **Cloudflare**, with logins, the database and the scheduled sync on **Supabase**.

## What comes from England Hockey, and what doesn't

The `eh-sync` function reads each side's page on englandhockey.co.uk (e.g. `/teams/felixstowe-1-mens`) and the match page for every played fixture. It brings in:

- every league fixture (date, opponent, home or away) and the final score
- **line-ups**: who played, with goalkeepers marked
- **goals** (field goals, penalty corners, penalty strokes) and **green, yellow and red cards**

New players are created automatically the first time they appear in a line-up. Their points count straight away, but they can't be picked until a manager gives them a position and price (Manage > Players).

Not published, so entered by hand on the fixture page: **player of the match**, assists, and outfield positions. Players who haven't made their GMS profile public show as "Name Withheld", but England Hockey still gives them a member id and tags their goals and cards, so they're imported as "Name withheld #5 (M3)". Correct the name once (on the match page or Manage > Players) and every later sync keeps it; if you'd already added them by hand, "or this is…" merges the two. The sync only updates goals and cards for the named players it lists, so manual additions, player of the match and assists are kept. If England Hockey has something wrong, tick "Lock this match" on the fixture to stop the sync changing it.

If England Hockey change their site the sync may stop working. Everything else keeps working and stats can be entered by hand.

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

GitHub deploys the sync function, so nothing runs on your computer.

1. Supabase: **Account > Access Tokens** (https://supabase.com/dashboard/account/tokens), create a token named `github-hockey`, copy it.
2. GitHub repo: **Settings > Secrets and variables > Actions > New repository secret**, add:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1
   - `EH_SYNC_SECRET`: any long random string (keep a copy for the schedule below)
3. GitHub repo: **Actions > Deploy Supabase functions > Run workflow**. It also redeploys by itself whenever the function changes on `main`.

Managers can now press **Sync from England Hockey** in the app. To run it automatically on Sunday and Monday evenings, enable the `pg_cron` and `pg_net` extensions (Database > Extensions) and run this in the SQL editor:

```sql
select cron.schedule('ff-eh-sync', '0 20 * * 0,1', $$
  select net.http_post(
    url := 'https://sovfxpamgrpsjswcjwkt.supabase.co/functions/v1/eh-sync',
    headers := '{"Authorization":"Bearer <EH_SYNC_SECRET>"}'::jsonb
  );
$$);
```

### 4. Start the season

1. Open the site and **register first**: the first account becomes the league manager. Give others manager access from Manage > Users.
2. Press **Sync from England Hockey**. This loads fixtures and creates the gameweeks (one per weekend, deadline Saturday 10:00 UK time). Adjust in Manage > Deadlines.
3. **Manage > Players**: everyone who has played so far is listed under "New from England Hockey". Give each a position and price and press Save. You can also paste extra players, one per line: `Name, Position, Side, Price`.
4. Share the link. After each weekend, sync (or let the schedule do it), give any new players a position, and tick player of the match on each fixture under **Fixtures & stats**.

## Game rules

Defaults, changeable in Manage > Settings: 11 players in one of the allowed formations (4-4-2, 4-3-3, 3-4-3, 3-5-2, 5-3-2, 4-5-1, 5-4-1), 100.0m budget, max 4 from one side, 2 transfers per gameweek (the first squad is free). Squads carry over each week until changed, and other people's squads are hidden until the deadline.

**Prices.** Manage > Players > "Set prices from points" prices everyone from their points per game so far, ranked against their own position, from 4.0m to 10.0m. After each gameweek's weekend, everyone who played moves by up to 0.3m depending on how they scored against their position's average that week. The sync applies this automatically, once per gameweek.

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

**Bank.** Your first squad costs what it costs; the rest of the 100.0m is your bank. Selling a player adds their current price to the bank and buying one takes theirs away, so players who rise increase what you can spend and players who fall reduce it.

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
