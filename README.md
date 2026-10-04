# Felixstowe HC Fantasy Hockey

A fantasy hockey league using only Felixstowe Hockey Club players, from every adult side (Men's 1s to 4s, Women's 1s to 3s).

- **Players** sign up, pick an 11 within a budget, choose a captain, and make transfers each gameweek.
- **Managers** sync fixtures and scores from England Hockey, and enter who played, goals, assists, cards and player of the match.
- **League table** updates as soon as stats are entered for a gameweek whose deadline has passed.

## What comes from England Hockey, and what doesn't

Felixstowe's team pages on englandhockey.co.uk (e.g. `/teams/felixstowe-1-mens`) load fixtures and results from a public JSON feed. The sync uses that feed to bring in:

- every league fixture for each side, with date, opponent and home/away
- final scores (so clean sheets, goals conceded and wins are automatic)

The feed does **not** include scorers, cards or line-ups for these leagues, so those are entered in the manager dashboard after each weekend. Cup games and friendlies can be added by hand too.

If England Hockey change their site the sync may stop working. Everything else keeps working and fixtures can be added by hand.

## Running it locally

Needs Python 3.11+.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export FLASK_APP=wsgi.py
flask sync-eh        # pull fixtures and scores from England Hockey
flask run            # http://localhost:5000
```

The **first account you register becomes the league manager**. Give others manager access from Manage > Users, or with `flask make-admin someone@example.com`.

To try the game with made-up players: `flask seed-demo`. Don't run it on the real league database.

Run the tests with `pytest`.

## Setting up the season

1. Register (you become the manager).
2. **Manage > Players**: paste in the squad, one per line: `Name, Position, Side, Price`, e.g. `Jo Bloggs, MID, M1, 8.5`. Positions are GK, DEF, MID, FWD. Sides are M1-M4 and W1-W3.
3. **Sync from England Hockey** to load fixtures. This also creates the gameweeks (one per weekend, deadline Saturday 10:00). Adjust deadlines in **Manage > Deadlines**.
4. Share the link. People register and pick their squads.
5. After each weekend: sync again for scores, then open each fixture under **Fixtures & stats** and tick who played and what they did. The overview page lists results still waiting for stats.

A player who turns out for a different side (playing up, covering) can be added to that fixture from the "other sides" list, and their points still count.

## Game rules

Defaults, changeable in Manage > Settings: 11 players, 100.0m budget, max 4 from one side, 2 transfers per gameweek (the first squad is free). Squads carry over each week until changed.

| Event | Points |
| --- | --- |
| Playing | 1 |
| Goal | GK/DEF 6, MID 5, FWD 4 |
| Assist | 3 |
| Clean sheet | GK/DEF 4, MID 1 |
| Every 2 goals conceded | GK/DEF -1 |
| Team win | 2 |
| Player of the match | 3 |
| Green / yellow / red card | -1 / -2 / -4 |
| Captain | x2 |

Point values live in `app/scoring.py`.

## Deploying

It's a standard Flask app (`wsgi:app`) and runs on any host that supports Python, e.g. Render, Railway, Fly.io or PythonAnywhere.

```bash
gunicorn wsgi:app
```

Set these environment variables:

- `SECRET_KEY`: a long random string. Required in production, or anyone could forge logins.
- `DATABASE_URL`: optional. Defaults to SQLite in `instance/fantasy.db`. On hosts with a temporary disk, use Postgres (add `psycopg[binary]` to requirements) so data survives restarts.
- `LEAGUE_NAME`: optional, changes the site title.

To sync automatically, schedule `flask sync-eh` (e.g. Sunday and Monday evenings) with your host's cron feature.

## Project layout

```
app/
  __init__.py   app setup and CLI commands (sync-eh, make-admin, seed-demo)
  models.py     database tables
  scoring.py    points rules
  league.py     squad rules, transfers, league table
  eh_sync.py    England Hockey import
  auth.py       sign up, log in, account
  main.py       player-facing pages
  admin.py      manager dashboard
  templates/    pages
tests/          pytest suite (uses a saved copy of the England Hockey feed)
```
