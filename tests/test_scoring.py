from app.models import Performance, Player, Team, db
from app.scoring import performance_points

from .conftest import make_fixture, make_gameweek


def perf(position, goals_for, goals_against, **stats):
    team = Team.query.first()
    player = Player(name="X", position=position, team=team, price=50)
    db.session.add(player)
    fixture = make_fixture(team, make_gameweek(-1), goals_for, goals_against)
    p = Performance(player=player, fixture=fixture, **stats)
    db.session.add(p)
    db.session.commit()
    return p


def test_defender_goal_clean_sheet_and_win(app):
    # 1 played + 6 goal + 4 clean sheet + 2 win
    assert performance_points(perf("DEF", 2, 0, goals=1)) == 13


def test_goalkeeper_loses_points_for_conceding(app):
    # 1 played - 3 for 6 conceded
    assert performance_points(perf("GK", 0, 6)) == -2


def test_forward_cards_and_player_of_match(app):
    # 1 + 2 goals*4 + 1 assist*3 + PoM 3 - green 1 - yellow 2, draw, no clean sheet points for FWD
    p = perf("FWD", 2, 2, goals=2, assists=1, player_of_match=True, green_cards=1, yellow_cards=1)
    assert performance_points(p) == 1 + 8 + 3 + 3 - 1 - 2


def test_no_result_yet_means_no_team_points(app):
    assert performance_points(perf("MID", None, None, goals=1)) == 6
