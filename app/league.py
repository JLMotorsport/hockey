"""Squad rules, transfers and standings."""

from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from .models import FantasyTeam, Fixture, Gameweek, Performance, Pick, Player, db
from .scoring import CAPTAIN_MULTIPLIER, performance_points

UK = ZoneInfo("Europe/London")

# Formation limits for an 11-a-side squad.
GK_COUNT = 1
MIN_OUTFIELD = {"DEF": 3, "MID": 3, "FWD": 1}


def now_uk():
    """Current UK wall-clock time; deadlines and fixtures are stored the same way."""
    return datetime.now(UK).replace(tzinfo=None)


def squad_gameweek(fantasy_team, gameweek):
    """The gameweek whose saved picks apply to `gameweek` (latest at or before it)."""
    if gameweek is None:
        return None
    return (
        Gameweek.query.join(Pick, Pick.gameweek_id == Gameweek.id)
        .filter(Pick.fantasy_team_id == fantasy_team.id, Gameweek.start_date <= gameweek.start_date)
        .order_by(Gameweek.start_date.desc())
        .first()
    )


def squad_for(fantasy_team, gameweek):
    source = squad_gameweek(fantasy_team, gameweek)
    if source is None:
        return []
    return Pick.query.filter_by(fantasy_team_id=fantasy_team.id, gameweek_id=source.id).all()


def previous_gameweek(gameweek):
    return (
        Gameweek.query.filter(Gameweek.start_date < gameweek.start_date)
        .order_by(Gameweek.start_date.desc())
        .first()
    )


def transfers_used(fantasy_team, gameweek, new_player_ids):
    """How many players in `new_player_ids` weren't in the squad going into `gameweek`.

    Returns None when there is no earlier squad, i.e. the first squad is free.
    """
    before = previous_gameweek(gameweek)
    previous = squad_for(fantasy_team, before) if before else []
    if not previous:
        return None
    return len(set(new_player_ids) - {p.player_id for p in previous})


def validate_squad(fantasy_team, gameweek, player_ids, captain_id, settings):
    errors = []
    unique_ids = set(player_ids)
    if len(unique_ids) != len(player_ids):
        errors.append("A player can only be picked once.")

    players = Player.query.filter(Player.id.in_(unique_ids)).all() if unique_ids else []
    if len(players) != len(unique_ids):
        errors.append("One of the selected players doesn't exist.")

    if len(unique_ids) != settings.squad_size:
        errors.append(f"Pick exactly {settings.squad_size} players (you have {len(unique_ids)}).")

    current = {p.player_id for p in squad_for(fantasy_team, gameweek)}
    for player in players:
        if not player.active and player.id not in current:
            errors.append(f"{player.name} isn't available for selection.")

    positions = Counter(p.position for p in players)
    if positions["GK"] != GK_COUNT:
        errors.append("Pick exactly 1 goalkeeper.")
    for position, minimum in MIN_OUTFIELD.items():
        if positions[position] < minimum:
            errors.append(f"Pick at least {minimum} {position}.")

    cost = sum(p.price for p in players)
    if cost > settings.budget and unique_ids != current:
        errors.append(f"Squad costs {cost / 10:.1f}m, over the {settings.budget / 10:.1f}m budget.")

    per_team = Counter(p.team.name for p in players)
    for team_name, count in per_team.items():
        if count > settings.max_per_team:
            errors.append(f"Max {settings.max_per_team} players from {team_name} (you have {count}).")

    if captain_id not in unique_ids:
        errors.append("Choose a captain from your squad.")

    used = transfers_used(fantasy_team, gameweek, unique_ids)
    if used is not None and used > settings.transfers_per_gameweek:
        errors.append(
            f"That's {used} transfers; only {settings.transfers_per_gameweek} allowed per gameweek."
        )
    return errors


def save_squad(fantasy_team, gameweek, player_ids, captain_id):
    Pick.query.filter_by(fantasy_team_id=fantasy_team.id, gameweek_id=gameweek.id).delete()
    for player_id in set(player_ids):
        db.session.add(
            Pick(
                fantasy_team_id=fantasy_team.id,
                gameweek_id=gameweek.id,
                player_id=player_id,
                is_captain=player_id == captain_id,
            )
        )
    db.session.commit()


def player_points_by_gameweek():
    """{gameweek_id: {player_id: points}} across every recorded performance."""
    totals = defaultdict(lambda: defaultdict(int))
    rows = Performance.query.join(Fixture).options(db.joinedload(Performance.player), db.joinedload(Performance.fixture))
    for perf in rows:
        totals[perf.fixture.gameweek_id][perf.player_id] += performance_points(perf)
    return totals


def gameweek_score(fantasy_team, gameweek, points=None):
    """(total, [(pick, player_points)]) for one fantasy team in one gameweek."""
    if points is None:
        points = player_points_by_gameweek()
    gw_points = points.get(gameweek.id, {})
    rows = []
    total = 0
    for pick in squad_for(fantasy_team, gameweek):
        base = gw_points.get(pick.player_id, 0)
        scored = base * CAPTAIN_MULTIPLIER if pick.is_captain else base
        rows.append((pick, scored))
        total += scored
    return total, rows


def standings(now=None):
    """Leaderboard rows for every gameweek whose deadline has passed."""
    now = now or now_uk()
    locked = Gameweek.query.filter(Gameweek.deadline <= now).order_by(Gameweek.start_date).all()
    latest = locked[-1] if locked else None
    points = player_points_by_gameweek()
    table = []
    for team in FantasyTeam.query.all():
        total = 0
        latest_points = 0
        for gw in locked:
            gw_total, _ = gameweek_score(team, gw, points)
            total += gw_total
            if gw is latest:
                latest_points = gw_total
        table.append({"team": team, "total": total, "latest": latest_points})
    table.sort(key=lambda row: (-row["total"], -row["latest"], row["team"].name.lower()))
    for rank, row in enumerate(table, start=1):
        row["rank"] = rank
    return table, latest


def player_season_points():
    totals = defaultdict(int)
    for gw_points in player_points_by_gameweek().values():
        for player_id, pts in gw_points.items():
            totals[player_id] += pts
    return totals
