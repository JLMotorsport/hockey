from datetime import datetime
from functools import wraps

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from .eh_sync import sync_all
from .models import (
    POSITIONS,
    Fixture,
    Gameweek,
    LeagueSettings,
    Performance,
    Player,
    Team,
    User,
    db,
)

bp = Blueprint("admin", __name__, url_prefix="/manage")

STAT_FIELDS = ["goals", "assists", "green_cards", "yellow_cards", "red_cards"]


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def parse_price(value, maximum=500):
    """'8.5' -> 85. Raises ValueError on junk."""
    price = round(float(value) * 10)
    if price <= 0 or price > maximum:
        raise ValueError("price out of range")
    return price


def parse_int(value, default=0):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


@bp.route("/")
@admin_required
def overview():
    gameweeks = Gameweek.ordered()
    return render_template(
        "admin/overview.html",
        gameweeks=gameweeks,
        player_count=Player.query.filter_by(active=True).count(),
        user_count=User.query.count(),
        teams=Team.query.order_by(Team.sort_order).all(),
    )


@bp.route("/sync", methods=["POST"])
@admin_required
def sync():
    for message in sync_all():
        flash(message, "error" if "failed" in message else "success")
    return redirect(request.referrer or url_for("admin.overview"))


# Players -----------------------------------------------------------------


@bp.route("/players", methods=["GET", "POST"])
@admin_required
def players():
    teams = Team.query.order_by(Team.sort_order).all()
    if request.method == "POST":
        added, problems = 0, []
        team_lookup = {t.short_name.lower(): t for t in teams} | {t.name.lower(): t for t in teams}
        for line_no, line in enumerate(request.form.get("bulk", "").splitlines(), start=1):
            if not line.strip():
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) != 4:
                problems.append(f"Line {line_no}: expected 'Name, Position, Team, Price'.")
                continue
            name, position, team_key, price = parts
            team = team_lookup.get(team_key.lower())
            if position.upper() not in POSITIONS or team is None or not name:
                problems.append(f"Line {line_no}: check the position ({'/'.join(POSITIONS)}) and team.")
                continue
            try:
                price_value = parse_price(price)
            except ValueError:
                problems.append(f"Line {line_no}: price should be a number like 7.5.")
                continue
            db.session.add(Player(name=name, position=position.upper(), team=team, price=price_value))
            added += 1
        db.session.commit()
        if added:
            flash(f"Added {added} player(s).", "success")
        for problem in problems:
            flash(problem, "error")
        return redirect(url_for("admin.players"))

    all_players = Player.query.join(Team).order_by(Team.sort_order, Player.position_order(), Player.name).all()
    return render_template("admin/players.html", players=all_players, teams=teams, positions=POSITIONS)


@bp.route("/players/<int:player_id>", methods=["POST"])
@admin_required
def edit_player(player_id):
    player = db.get_or_404(Player, player_id)
    name = request.form.get("name", "").strip()
    position = request.form.get("position", "")
    team = db.session.get(Team, request.form.get("team_id", type=int) or 0)
    try:
        price = parse_price(request.form.get("price", ""))
    except ValueError:
        flash("Price should be a number like 7.5.", "error")
        return redirect(url_for("admin.players"))
    if not name or position not in POSITIONS or team is None:
        flash("Name, position and team are all required.", "error")
        return redirect(url_for("admin.players"))
    player.name, player.position, player.team, player.price = name, position, team, price
    player.active = bool(request.form.get("active"))
    db.session.commit()
    flash(f"Saved {player.name}.", "success")
    return redirect(url_for("admin.players") + f"#player-{player.id}")


# Fixtures and stats --------------------------------------------------------


@bp.route("/fixtures", methods=["GET", "POST"])
@admin_required
def fixtures():
    teams = Team.query.order_by(Team.sort_order).all()
    if request.method == "POST":
        team = db.session.get(Team, request.form.get("team_id", type=int) or 0)
        opponent = request.form.get("opponent", "").strip()
        try:
            kickoff = datetime.fromisoformat(request.form.get("kickoff", ""))
        except ValueError:
            kickoff = None
        if team is None or not opponent or kickoff is None:
            flash("Team, opponent and date/time are required.", "error")
        else:
            fixture = Fixture(
                team=team,
                opponent=opponent,
                kickoff=kickoff,
                is_home=request.form.get("is_home") == "1",
                competition=request.form.get("competition", "").strip() or "Friendly / cup",
                gameweek=Gameweek.for_date(kickoff.date()),
            )
            db.session.add(fixture)
            db.session.commit()
            flash("Fixture added.", "success")
            return redirect(url_for("admin.fixture", fixture_id=fixture.id))

    gameweeks = Gameweek.ordered()
    return render_template("admin/fixtures.html", gameweeks=gameweeks, teams=teams)


@bp.route("/fixtures/<int:fixture_id>", methods=["GET", "POST"])
@admin_required
def fixture(fixture_id):
    fixture = db.get_or_404(Fixture, fixture_id)
    if request.method == "POST":
        goals_for = request.form.get("goals_for", "").strip()
        goals_against = request.form.get("goals_against", "").strip()
        if goals_for and goals_against:
            new_score = (parse_int(goals_for), parse_int(goals_against))
            if new_score != (fixture.goals_for, fixture.goals_against):
                fixture.goals_for, fixture.goals_against = new_score
                fixture.score_overridden = True
        elif not goals_for and not goals_against and fixture.score_overridden:
            # Clearing both boxes hands the score back to the England Hockey sync.
            fixture.score_overridden = False

        existing = {p.player_id: p for p in fixture.performances}
        played_ids = {int(x) for x in request.form.getlist("played") if x.isdigit()}
        potm_id = request.form.get("player_of_match", type=int)
        for player_id, perf in existing.items():
            if player_id not in played_ids:
                db.session.delete(perf)
        for player_id in played_ids:
            if db.session.get(Player, player_id) is None:
                continue
            perf = existing.get(player_id) or Performance(player_id=player_id, fixture=fixture)
            for field in STAT_FIELDS:
                setattr(perf, field, parse_int(request.form.get(f"{field}_{player_id}")))
            perf.player_of_match = player_id == potm_id
            db.session.add(perf)
        fixture.stats_complete = bool(request.form.get("stats_complete"))
        db.session.commit()
        flash("Match stats saved.", "success")
        return redirect(url_for("admin.fixture", fixture_id=fixture.id))

    performances = {p.player_id: p for p in fixture.performances}
    squad = Player.query.filter_by(team_id=fixture.team_id).order_by(Player.position_order(), Player.name).all()
    # Players from other sides who played in this game (covering, playing up).
    extra_ids = set(performances) - {p.id for p in squad}
    extras = Player.query.filter(Player.id.in_(extra_ids)).all() if extra_ids else []
    others = (
        Player.query.join(Team)
        .filter(Player.team_id != fixture.team_id, Player.active.is_(True))
        .order_by(Team.sort_order, Player.name)
        .all()
    )
    return render_template(
        "admin/fixture.html",
        fixture=fixture,
        players=squad + extras,
        others=[p for p in others if p.id not in extra_ids],
        performances=performances,
    )


@bp.route("/fixtures/<int:fixture_id>/delete", methods=["POST"])
@admin_required
def delete_fixture(fixture_id):
    fixture = db.get_or_404(Fixture, fixture_id)
    if fixture.eh_fixture_id:
        flash("Synced fixtures come back on the next sync, so they can't be deleted.", "error")
        return redirect(url_for("admin.fixture", fixture_id=fixture.id))
    db.session.delete(fixture)
    db.session.commit()
    flash("Fixture deleted.", "success")
    return redirect(url_for("admin.fixtures"))


# Gameweeks, teams, users, settings ---------------------------------------


@bp.route("/gameweeks", methods=["GET", "POST"])
@admin_required
def gameweeks():
    if request.method == "POST":
        gameweek = db.session.get(Gameweek, request.form.get("gameweek_id", type=int) or 0)
        try:
            deadline = datetime.fromisoformat(request.form.get("deadline", ""))
        except ValueError:
            deadline = None
        if gameweek is None or deadline is None:
            flash("Pick a valid deadline.", "error")
        else:
            gameweek.deadline = deadline
            db.session.commit()
            flash(f"Deadline updated for {gameweek.label}.", "success")
        return redirect(url_for("admin.gameweeks"))
    return render_template("admin/gameweeks.html", gameweeks=Gameweek.ordered())


@bp.route("/teams", methods=["GET", "POST"])
@admin_required
def teams():
    if request.method == "POST":
        team_id = request.form.get("team_id", type=int)
        name = request.form.get("name", "").strip()
        short_name = request.form.get("short_name", "").strip()
        eh_slug = request.form.get("eh_slug", "").strip() or None
        if not name or not short_name:
            flash("Name and short name are required.", "error")
            return redirect(url_for("admin.teams"))
        team = db.session.get(Team, team_id) if team_id else Team(sort_order=Team.query.count())
        team.name, team.short_name, team.eh_slug = name, short_name[:20], eh_slug
        db.session.add(team)
        try:
            db.session.commit()
            flash(f"Saved {team.name}.", "success")
        except Exception:
            db.session.rollback()
            flash("That team name or England Hockey slug is already in use.", "error")
        return redirect(url_for("admin.teams"))
    return render_template("admin/teams.html", teams=Team.query.order_by(Team.sort_order).all())


@bp.route("/users", methods=["GET", "POST"])
@admin_required
def users():
    if request.method == "POST":
        user = db.get_or_404(User, request.form.get("user_id", type=int) or 0)
        if user.id == current_user.id:
            flash("You can't remove your own manager access.", "error")
        else:
            user.is_admin = not user.is_admin
            db.session.commit()
            flash(f"{user.display_name} is {'now' if user.is_admin else 'no longer'} a manager.", "success")
        return redirect(url_for("admin.users"))
    return render_template("admin/users.html", users=User.query.order_by(User.display_name).all())


@bp.route("/settings", methods=["GET", "POST"])
@admin_required
def settings():
    league_settings = LeagueSettings.get()
    if request.method == "POST":
        try:
            league_settings.budget = parse_price(request.form.get("budget", ""), maximum=10000)
        except ValueError:
            flash("Budget should be a number like 100.0.", "error")
            return redirect(url_for("admin.settings"))
        league_settings.max_per_team = max(1, parse_int(request.form.get("max_per_team"), 4))
        league_settings.transfers_per_gameweek = parse_int(request.form.get("transfers_per_gameweek"), 2)
        db.session.commit()
        flash("Settings saved.", "success")
        return redirect(url_for("admin.settings"))
    return render_template("admin/settings.html", settings=league_settings)
