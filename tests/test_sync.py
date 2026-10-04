from datetime import date

from app.eh_sync import import_team_fixtures, sync_all
from app.models import Fixture, Gameweek, Team, db


def m1():
    return Team.query.filter_by(eh_slug="felixstowe-1-mens").one()


def test_import_creates_fixtures_and_gameweeks(app, eh_payload):
    created, updated = import_team_fixtures(m1(), eh_payload)
    assert (created, updated) == (6, 0)
    assert Gameweek.query.count() == 6
    assert m1().competition == "East Open - Men's Division 1 North"

    home_loss = Fixture.query.filter_by(opponent="City Of Peterborough 2").one()
    assert home_loss.is_home and (home_loss.goals_for, home_loss.goals_against) == (1, 4)
    # Away scores are flipped so goals_for is always Felixstowe's.
    away = Fixture.query.filter_by(opponent="Spalding 1").one()
    assert not away.is_home and (away.goals_for, away.goals_against) == (0, 6)
    upcoming = Fixture.query.filter_by(opponent="Kettering 1").one()
    assert not upcoming.has_result
    # Saturday 12 Sep 2026 fixture lands in the gameweek starting that Saturday.
    assert home_loss.gameweek.start_date == date(2026, 9, 12)


def test_reimport_is_idempotent_and_respects_manual_scores(app, eh_payload):
    import_team_fixtures(m1(), eh_payload)
    fixture = Fixture.query.filter_by(opponent="Cambridge 1").one()
    fixture.goals_for, fixture.goals_against, fixture.score_overridden = 7, 3, True
    db.session.commit()

    created, updated = import_team_fixtures(m1(), eh_payload)
    assert (created, updated) == (0, 6)
    assert Fixture.query.count() == 6
    assert (fixture.goals_for, fixture.goals_against) == (7, 3)


def test_two_felixstowe_sides_meeting_get_a_fixture_each(app):
    w2 = Team.query.filter_by(short_name="W2").one()
    w3 = Team.query.filter_by(short_name="W3").one()
    shared = [{
        "competitionName": "East Women's Division 4",
        "fixtures": [{
            "id": "same-id", "fixtureDate": "2026-10-10T12:00:00", "isResult": True, "isBye": False,
            "homeTeamScore": "2", "awayTeamScore": "1",
            "homeTeam": {"teamName": "Felixstowe 2", "entityUrlSlug": w2.eh_slug},
            "awayTeam": {"teamName": "Felixstowe 3", "entityUrlSlug": w3.eh_slug},
        }],
    }]
    import_team_fixtures(w2, shared)
    import_team_fixtures(w3, shared)
    rows = {f.team.short_name: f for f in Fixture.query.all()}
    assert (rows["W2"].goals_for, rows["W2"].goals_against) == (2, 1)
    assert (rows["W3"].goals_for, rows["W3"].goals_against) == (1, 2)


def test_sync_all_reports_failures_per_team(app, eh_payload):
    def fake_fetch(slug):
        if slug == "felixstowe-1-mens":
            return eh_payload
        raise ValueError("boom")

    messages = sync_all(fetch=fake_fetch)
    assert messages[0].startswith("Men's 1s: 6 new")
    assert any("failed" in m for m in messages[1:])
    assert Fixture.query.count() == 6
