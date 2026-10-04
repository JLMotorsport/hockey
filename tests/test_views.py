from app.models import Fixture, Gameweek, Performance, Pick, User, db

from .conftest import make_fixture, make_gameweek, make_players, make_user


def register(client, email, team="Team"):
    return client.post(
        "/register",
        data={"email": email, "display_name": "Name", "team_name": team, "password": "password123"},
    )


def login(client, email):
    return client.post("/login", data={"email": email, "password": "password123"})


def test_first_registration_is_manager_and_second_is_not(client):
    register(client, "first@example.com")
    client.post("/logout")
    register(client, "second@example.com")
    assert User.query.filter_by(email="first@example.com").one().is_admin
    assert not User.query.filter_by(email="second@example.com").one().is_admin
    assert client.get("/manage/").status_code == 403


def test_pages_render(client):
    make_players()
    gw = make_gameweek(3)
    make_fixture(make_players()[0].team, gw, 2, 1)
    assert client.get("/").status_code == 200
    register(client, "me@example.com")
    for url in ["/dashboard", "/squad", "/leaderboard", "/players", "/fixtures", "/rules", "/account",
                "/manage/", "/manage/players", "/manage/fixtures", "/manage/gameweeks", "/manage/teams",
                "/manage/users", "/manage/settings", f"/manage/fixtures/{Fixture.query.first().id}"]:
        assert client.get(url).status_code == 200, url


def test_pick_squad_via_form(client):
    players = make_players()
    gw = make_gameweek(3)
    register(client, "me@example.com")
    squad = [p.id for p in players[:11]]
    resp = client.post("/squad", data={"player_ids": squad, "captain_id": squad[3]})
    assert resp.status_code == 302
    picks = Pick.query.filter_by(gameweek_id=gw.id).all()
    assert len(picks) == 11
    assert [p.player_id for p in picks if p.is_captain] == [squad[3]]


def test_invalid_squad_shows_errors(client):
    players = make_players()
    make_gameweek(3)
    register(client, "me@example.com")
    resp = client.post("/squad", data={"player_ids": [players[0].id], "captain_id": players[0].id})
    assert resp.status_code == 200
    assert b"Pick exactly 11 players" in resp.data
    assert Pick.query.count() == 0


def test_squad_changes_go_to_next_open_gameweek(client):
    players = make_players()
    make_gameweek(-1)
    upcoming = make_gameweek(6)
    register(client, "me@example.com")
    squad = [p.id for p in players[:11]]
    client.post("/squad", data={"player_ids": squad, "captain_id": squad[0]})
    assert {p.gameweek_id for p in Pick.query.all()} == {upcoming.id}


def test_manager_enters_match_stats(client):
    players = make_players()
    gw = make_gameweek(-1)
    team = players[0].team
    fixture = make_fixture(team, gw)
    register(client, "boss@example.com")
    other = players[1]  # plays for a different side, covering this game
    resp = client.post(
        f"/manage/fixtures/{fixture.id}",
        data={
            "goals_for": "3", "goals_against": "0",
            "played": [str(players[0].id), str(other.id)],
            f"goals_{players[0].id}": "2",
            "player_of_match": str(players[0].id),
            "stats_complete": "1",
        },
    )
    assert resp.status_code == 302
    db.session.refresh(fixture)
    assert (fixture.goals_for, fixture.goals_against, fixture.score_overridden) == (3, 0, True)
    assert fixture.stats_complete
    perfs = {p.player_id: p for p in Performance.query.all()}
    assert perfs[players[0].id].goals == 2 and perfs[players[0].id].player_of_match
    assert other.id in perfs

    # Unticking "played" removes the stat line.
    client.post(f"/manage/fixtures/{fixture.id}", data={"goals_for": "3", "goals_against": "0", "played": [str(players[0].id)]})
    assert Performance.query.count() == 1


def test_bulk_add_players(client):
    register(client, "boss@example.com")
    resp = client.post("/manage/players", data={"bulk": "Jo Bloggs, MID, M1, 8.5\nbad line\nSam Keeper, GK, W2, 6"})
    assert resp.status_code == 302
    from app.models import Player
    names = {p.name: p for p in Player.query.all()}
    assert names["Jo Bloggs"].price == 85 and names["Sam Keeper"].team.short_name == "W2"
    assert len(names) == 2


def test_manual_fixture_creates_gameweek(client):
    register(client, "boss@example.com")
    from app.models import Team
    team = Team.query.first()
    client.post("/manage/fixtures", data={"team_id": team.id, "opponent": "Ipswich", "kickoff": "2026-12-27T11:00", "is_home": "1"})
    fixture = Fixture.query.one()
    assert fixture.gameweek.start_date.isoformat() == "2026-12-26"
    assert Gameweek.query.count() == 1


def test_login_ignores_external_next(client):
    make_user("me@example.com")
    resp = client.post("/login?next=https://evil.example/", data={"email": "me@example.com", "password": "password123"})
    assert resp.headers["Location"] == "/dashboard"


def test_csrf_is_on_by_default(tmp_path):
    from app import create_app
    app = create_app({"SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'csrf.db'}"})
    resp = app.test_client().post("/login", data={"email": "x@example.com", "password": "x"})
    assert resp.status_code == 400
