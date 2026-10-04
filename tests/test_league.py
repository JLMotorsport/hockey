from app import league
from app.models import LeagueSettings, Performance, db

from .conftest import make_fixture, make_gameweek, make_players, make_user

XI = list(range(11))  # indexes into make_players(): 1 GK, 4 DEF, 4 MID, 2 FWD


def ids(players, indexes):
    return [players[i].id for i in indexes]


def test_valid_squad(app):
    team = make_user().fantasy_team
    players = make_players()
    gw = make_gameweek(3)
    squad = ids(players, XI)
    assert league.validate_squad(team, gw, squad, squad[0], LeagueSettings.get()) == []


def test_squad_rules(app):
    team = make_user().fantasy_team
    players = make_players()
    gw = make_gameweek(3)
    settings = LeagueSettings.get()

    def errors(indexes, captain=None):
        squad = ids(players, indexes)
        return " ".join(league.validate_squad(team, gw, squad, captain or squad[0], settings))

    assert "exactly 11" in errors(XI[:10])
    # Swap a forward for the second goalkeeper.
    assert "1 goalkeeper" in errors(XI[:10] + [11])
    assert "captain" in errors(XI, captain=players[12].id)

    players[0].price = 500
    db.session.commit()
    assert "budget" in errors(XI)
    players[0].price = 60

    settings.max_per_team = 1
    db.session.commit()
    assert "Max 1 players" in errors(XI)


def test_squad_carries_forward_and_transfers_are_limited(app):
    team = make_user().fantasy_team
    players = make_players()
    gw1, gw2, gw3 = make_gameweek(1), make_gameweek(8), make_gameweek(15)
    settings = LeagueSettings.get()
    first = ids(players, XI)
    league.save_squad(team, gw1, first, first[0])

    assert {p.player_id for p in league.squad_for(team, gw3)} == set(first)

    # Spare GK, FWD and DEF (11, 12, 13) in for 0, 9 and 10: three transfers, over the limit of 2.
    three = ids(players, [11, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13])
    errs = league.validate_squad(team, gw2, three, three[0], settings)
    assert any("3 transfers" in e for e in errs)

    two = ids(players, [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12])
    assert league.validate_squad(team, gw2, two, two[0], settings) == []
    league.save_squad(team, gw2, two, two[0])
    # Re-saving the same gameweek still counts against the squad going into it.
    assert league.transfers_used(team, gw2, two) == 2
    assert {p.player_id for p in league.squad_for(team, gw1)} == set(first)
    assert {p.player_id for p in league.squad_for(team, gw3)} == set(two)


def test_standings_double_captain_and_ignore_open_gameweeks(app):
    alice = make_user("alice@example.com", team_name="Alice XI").fantasy_team
    bob = make_user("bob@example.com", team_name="Bob XI").fantasy_team
    players = make_players()
    locked = make_gameweek(-2)
    open_gw = make_gameweek(5)
    squad = ids(players, XI)
    striker = players[9]
    league.save_squad(alice, locked, squad, striker.id)
    league.save_squad(bob, locked, squad, squad[0])

    fixture = make_fixture(striker.team, locked, 3, 1)
    db.session.add(Performance(player=striker, fixture=fixture, goals=2))
    later = make_fixture(striker.team, open_gw, 1, 0)
    db.session.add(Performance(player=striker, fixture=later, goals=5))
    db.session.commit()

    table, latest = league.standings()
    assert latest.id == locked.id
    by_name = {row["team"].name: row for row in table}
    striker_points = 1 + 2 * 4 + 2  # played, 2 goals, win
    assert by_name["Alice XI"]["total"] == striker_points * 2
    assert by_name["Bob XI"]["total"] == striker_points
    assert table[0]["team"].name == "Alice XI"
