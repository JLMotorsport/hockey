from datetime import datetime, time, timedelta

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()

POSITIONS = ["GK", "DEF", "MID", "FWD"]
POSITION_NAMES = {"GK": "Goalkeeper", "DEF": "Defender", "MID": "Midfielder", "FWD": "Forward"}


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    display_name = db.Column(db.String(80), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    fantasy_team = db.relationship("FantasyTeam", back_populates="user", uselist=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Team(db.Model):
    """A real Felixstowe HC side (Men's 1s, Women's 2s, ...)."""

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    short_name = db.Column(db.String(20), nullable=False)
    # Slug of the team page on englandhockey.co.uk, e.g. "felixstowe-1-mens".
    eh_slug = db.Column(db.String(120), unique=True)
    competition = db.Column(db.String(160))
    sort_order = db.Column(db.Integer, default=0)

    players = db.relationship("Player", back_populates="team")
    fixtures = db.relationship("Fixture", back_populates="team")


class Player(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    position = db.Column(db.String(3), nullable=False)
    team_id = db.Column(db.Integer, db.ForeignKey("team.id"), nullable=False)
    # Price in tenths of a million so the maths stays in integers (85 = 8.5m).
    price = db.Column(db.Integer, nullable=False, default=50)
    active = db.Column(db.Boolean, default=True, nullable=False)

    team = db.relationship("Team", back_populates="players")
    performances = db.relationship("Performance", back_populates="player", cascade="all, delete-orphan")

    @classmethod
    def position_order(cls):
        """SQL expression to sort GK, DEF, MID, FWD rather than alphabetically."""
        return db.case({pos: i for i, pos in enumerate(POSITIONS)}, value=cls.position)

    @property
    def price_display(self):
        return f"{self.price / 10:.1f}"


class Gameweek(db.Model):
    """One playing weekend. start_date is the Saturday."""

    id = db.Column(db.Integer, primary_key=True)
    start_date = db.Column(db.Date, unique=True, nullable=False)
    deadline = db.Column(db.DateTime, nullable=False)

    fixtures = db.relationship("Fixture", back_populates="gameweek", order_by="Fixture.kickoff")

    @property
    def number(self):
        return Gameweek.query.filter(Gameweek.start_date <= self.start_date).count()

    @property
    def label(self):
        return f"GW{self.number} ({self.start_date.strftime('%d %b')})"

    @staticmethod
    def saturday_for(day):
        """The Saturday of the Monday-to-Sunday week containing `day`."""
        monday = day - timedelta(days=day.weekday())
        return monday + timedelta(days=5)

    @classmethod
    def for_date(cls, day, create=True):
        saturday = cls.saturday_for(day)
        gw = cls.query.filter_by(start_date=saturday).first()
        if gw is None and create:
            gw = cls(start_date=saturday, deadline=datetime.combine(saturday, time(10, 0)))
            db.session.add(gw)
            db.session.flush()
        return gw

    @classmethod
    def ordered(cls):
        return cls.query.order_by(cls.start_date).all()

    @classmethod
    def next_open(cls, now):
        """The gameweek that squad changes made right now would apply to."""
        return cls.query.filter(cls.deadline > now).order_by(cls.start_date).first()

    @classmethod
    def last_locked(cls, now):
        return cls.query.filter(cls.deadline <= now).order_by(cls.start_date.desc()).first()


class Fixture(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey("team.id"), nullable=False)
    gameweek_id = db.Column(db.Integer, db.ForeignKey("gameweek.id"), nullable=False)
    # Not unique on its own: when two Felixstowe sides meet, each gets a row.
    eh_fixture_id = db.Column(db.String(64))
    kickoff = db.Column(db.DateTime, nullable=False)
    opponent = db.Column(db.String(120), nullable=False)
    is_home = db.Column(db.Boolean, default=True, nullable=False)
    competition = db.Column(db.String(160))
    goals_for = db.Column(db.Integer)
    goals_against = db.Column(db.Integer)
    # Set when a manager edits the score so the next sync won't overwrite it.
    score_overridden = db.Column(db.Boolean, default=False, nullable=False)
    stats_complete = db.Column(db.Boolean, default=False, nullable=False)

    team = db.relationship("Team", back_populates="fixtures")
    gameweek = db.relationship("Gameweek", back_populates="fixtures")
    performances = db.relationship("Performance", back_populates="fixture", cascade="all, delete-orphan")

    __table_args__ = (db.UniqueConstraint("team_id", "eh_fixture_id"),)

    @property
    def has_result(self):
        return self.goals_for is not None and self.goals_against is not None

    @property
    def score_display(self):
        if not self.has_result:
            return "v"
        return f"{self.goals_for} - {self.goals_against}"


class Performance(db.Model):
    """One player's stat line for one fixture."""

    id = db.Column(db.Integer, primary_key=True)
    player_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    fixture_id = db.Column(db.Integer, db.ForeignKey("fixture.id"), nullable=False)
    goals = db.Column(db.Integer, default=0, nullable=False)
    assists = db.Column(db.Integer, default=0, nullable=False)
    green_cards = db.Column(db.Integer, default=0, nullable=False)
    yellow_cards = db.Column(db.Integer, default=0, nullable=False)
    red_cards = db.Column(db.Integer, default=0, nullable=False)
    player_of_match = db.Column(db.Boolean, default=False, nullable=False)

    player = db.relationship("Player", back_populates="performances")
    fixture = db.relationship("Fixture", back_populates="performances")

    __table_args__ = (db.UniqueConstraint("player_id", "fixture_id"),)


class FantasyTeam(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    name = db.Column(db.String(80), nullable=False)

    user = db.relationship("User", back_populates="fantasy_team")
    picks = db.relationship("Pick", back_populates="fantasy_team", cascade="all, delete-orphan")


class Pick(db.Model):
    """A player in a fantasy squad from `gameweek` onwards.

    Picks are only stored for gameweeks where the squad was changed. The squad
    for any gameweek is the most recent saved set at or before it, so nobody
    has to re-save their team every week.
    """

    id = db.Column(db.Integer, primary_key=True)
    fantasy_team_id = db.Column(db.Integer, db.ForeignKey("fantasy_team.id"), nullable=False)
    gameweek_id = db.Column(db.Integer, db.ForeignKey("gameweek.id"), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    is_captain = db.Column(db.Boolean, default=False, nullable=False)

    fantasy_team = db.relationship("FantasyTeam", back_populates="picks")
    gameweek = db.relationship("Gameweek")
    player = db.relationship("Player")

    __table_args__ = (db.UniqueConstraint("fantasy_team_id", "gameweek_id", "player_id"),)


class LeagueSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    budget = db.Column(db.Integer, default=1000, nullable=False)  # tenths, 1000 = 100.0m
    squad_size = db.Column(db.Integer, default=11, nullable=False)
    max_per_team = db.Column(db.Integer, default=4, nullable=False)
    transfers_per_gameweek = db.Column(db.Integer, default=2, nullable=False)

    @classmethod
    def get(cls):
        settings = db.session.get(cls, 1)
        if settings is None:
            settings = cls(id=1)
            db.session.add(settings)
            db.session.commit()
        return settings


DEFAULT_TEAMS = [
    # name, short name, England Hockey slug
    ("Men's 1s", "M1", "felixstowe-1-mens"),
    ("Men's 2s", "M2", "felixstowe-2-mens"),
    ("Men's 3s", "M3", "felixstowe-3-mens"),
    ("Men's 4s", "M4", "felixstowe-4-development-mens"),
    ("Women's 1s", "W1", "felixstowe-1-womens"),
    ("Women's 2s", "W2", "felixstowe-2-womens"),
    ("Women's 3s", "W3", "felixstowe-3-development-womens"),
]


def seed_teams():
    for order, (name, short, slug) in enumerate(DEFAULT_TEAMS):
        if not Team.query.filter_by(name=name).first():
            db.session.add(Team(name=name, short_name=short, eh_slug=slug, sort_order=order))
    db.session.commit()
