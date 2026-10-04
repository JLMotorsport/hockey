"""Pull Felixstowe fixtures and results from England Hockey.

The public team pages on englandhockey.co.uk (e.g. /teams/felixstowe-1-mens)
load their data from a JSON API. The page embeds the API URL and a public key
in data attributes, so we read those from the page each time rather than
hard-coding them.

That API returns fixtures and scores only. Scorers, cards and line-ups are not
published, so player stats are entered in the manager dashboard.
"""

import re
from datetime import datetime

import requests

from .models import Fixture, Gameweek, Team, db

EH_TEAM_PAGE = "https://www.englandhockey.co.uk/teams/{slug}"
TIMEOUT = 20


class SyncError(Exception):
    pass


def fetch_team_json(slug, session=requests):
    page = session.get(EH_TEAM_PAGE.format(slug=slug), timeout=TIMEOUT)
    page.raise_for_status()
    url = re.search(r'data-url="([^"]+fixturesandresults[^"]*)"', page.text)
    key = re.search(r'data-url-key="([^"]+)"', page.text)
    if not url or not key:
        raise SyncError(f"Couldn't find the fixtures feed on the {slug} page.")
    data = session.get(url.group(1), headers={"X-Api-Key": key.group(1)}, timeout=TIMEOUT)
    data.raise_for_status()
    return data.json()


def _score(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def import_team_fixtures(team, competitions):
    """Upsert fixtures for `team` from the API payload. Returns (created, updated)."""
    created = updated = 0
    for competition in competitions:
        for fx in competition.get("fixtures", []):
            if fx.get("isBye"):
                continue
            home = fx["homeTeam"].get("entityUrlSlug") == team.eh_slug
            opponent = fx["awayTeam" if home else "homeTeam"]["teamName"]
            kickoff = datetime.fromisoformat(fx["fixtureDate"])
            gameweek = Gameweek.for_date(kickoff.date())

            fixture = Fixture.query.filter_by(team_id=team.id, eh_fixture_id=fx["id"]).first()
            if fixture is None:
                fixture = Fixture(eh_fixture_id=fx["id"], team=team)
                db.session.add(fixture)
                created += 1
            else:
                updated += 1

            fixture.kickoff = kickoff
            fixture.gameweek = gameweek
            fixture.opponent = opponent
            fixture.is_home = home
            fixture.competition = competition.get("competitionName")
            if fx.get("isResult") and not fixture.score_overridden:
                home_score = _score(fx.get("homeTeamScore"))
                away_score = _score(fx.get("awayTeamScore"))
                if home_score is not None and away_score is not None:
                    fixture.goals_for, fixture.goals_against = (
                        (home_score, away_score) if home else (away_score, home_score)
                    )
            if competition.get("competitionName"):
                team.competition = competition["competitionName"]
    db.session.commit()
    return created, updated


def sync_all(fetch=fetch_team_json):
    """Sync every team with an England Hockey slug. Returns a list of messages."""
    messages = []
    for team in Team.query.filter(Team.eh_slug.isnot(None)).order_by(Team.sort_order):
        try:
            created, updated = import_team_fixtures(team, fetch(team.eh_slug))
            messages.append(f"{team.name}: {created} new, {updated} updated fixtures.")
        except (requests.RequestException, SyncError, KeyError, ValueError) as exc:
            db.session.rollback()
            messages.append(f"{team.name}: sync failed ({exc}).")
    return messages
