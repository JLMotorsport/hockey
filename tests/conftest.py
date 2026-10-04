import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app import create_app
from app.models import FantasyTeam, Fixture, Gameweek, Player, Team, User, db

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def app(tmp_path):
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'test.db'}",
            "WTF_CSRF_ENABLED": False,
        }
    )
    with app.app_context():
        yield app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def eh_payload():
    return json.loads((FIXTURES / "eh_felixstowe_1_mens.json").read_text())


def make_user(email="player@example.com", admin=False, team_name="Stick It"):
    user = User(email=email, display_name=email.split("@")[0], is_admin=admin)
    user.set_password("password123")
    db.session.add(user)
    db.session.add(FantasyTeam(user=user, name=team_name))
    db.session.commit()
    return user


def make_players():
    """Two full squads' worth of cheap players spread across the sides."""
    teams = Team.query.order_by(Team.sort_order).all()
    shape = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD", "GK", "FWD", "DEF"]
    players = []
    for i, position in enumerate(shape):
        player = Player(name=f"Player {i}", position=position, team=teams[i % len(teams)], price=60)
        db.session.add(player)
        players.append(player)
    db.session.commit()
    return players


def make_gameweek(days_from_now, deadline_offset_hours=0):
    """A gameweek whose deadline is `days_from_now` days away (negative = locked)."""
    deadline = datetime.now() + timedelta(days=days_from_now, hours=deadline_offset_hours)
    gw = Gameweek(start_date=deadline.date(), deadline=deadline)
    db.session.add(gw)
    db.session.commit()
    return gw


def make_fixture(team, gameweek, goals_for=None, goals_against=None):
    fixture = Fixture(
        team=team,
        gameweek=gameweek,
        kickoff=datetime.combine(gameweek.start_date, datetime.min.time()),
        opponent="Opponents",
        goals_for=goals_for,
        goals_against=goals_against,
    )
    db.session.add(fixture)
    db.session.commit()
    return fixture
