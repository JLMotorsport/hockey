from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from . import league
from .models import POSITIONS, FantasyTeam, Gameweek, LeagueSettings, Player, Team, db
from .scoring import RULES_TABLE

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))
    table, latest = league.standings()
    return render_template("index.html", table=table[:10], latest=latest)


@bp.route("/dashboard")
@login_required
def dashboard():
    team = current_user.fantasy_team
    now = league.now_uk()
    next_gw = Gameweek.next_open(now)
    last_gw = Gameweek.last_locked(now)
    points = league.player_points_by_gameweek()

    upcoming = league.squad_for(team, next_gw) if next_gw else []
    last_total, last_rows = league.gameweek_score(team, last_gw, points) if last_gw else (0, [])
    history = []
    for gw in Gameweek.query.filter(Gameweek.deadline <= now).order_by(Gameweek.start_date):
        total, _ = league.gameweek_score(team, gw, points)
        history.append((gw, total))
    table, _ = league.standings(now)
    my_row = next((row for row in table if row["team"].id == team.id), None)
    return render_template(
        "dashboard.html",
        team=team,
        next_gw=next_gw,
        last_gw=last_gw,
        upcoming=sorted(upcoming, key=lambda p: POSITIONS.index(p.player.position)),
        last_rows=sorted(last_rows, key=lambda r: POSITIONS.index(r[0].player.position)),
        last_total=last_total,
        history=history,
        my_row=my_row,
        league_size=len(table),
    )


@bp.route("/squad", methods=["GET", "POST"])
@login_required
def squad():
    team = current_user.fantasy_team
    settings = LeagueSettings.get()
    gameweek = Gameweek.next_open(league.now_uk())
    if gameweek is None:
        flash("There's no upcoming gameweek yet. A manager needs to sync or add fixtures.", "info")
        return redirect(url_for("main.dashboard"))

    current = league.squad_for(team, gameweek)
    selected = {p.player_id for p in current}
    captain_id = next((p.player_id for p in current if p.is_captain), None)

    if request.method == "POST":
        try:
            player_ids = [int(x) for x in request.form.getlist("player_ids")]
            captain_id = int(request.form.get("captain_id") or 0)
        except ValueError:
            abort(400)
        # Re-check the deadline on submit in case the page sat open past it.
        if gameweek.deadline <= league.now_uk():
            flash("The deadline passed before you saved.", "error")
            return redirect(url_for("main.squad"))
        errors = league.validate_squad(team, gameweek, player_ids, captain_id, settings)
        if not errors:
            league.save_squad(team, gameweek, player_ids, captain_id)
            flash(f"Squad saved for {gameweek.label}.", "success")
            return redirect(url_for("main.dashboard"))
        for error in errors:
            flash(error, "error")
        selected = set(player_ids)

    players = (
        Player.query.join(Team)
        .filter(db.or_(Player.active.is_(True), Player.id.in_(selected or [0])))
        .order_by(Team.sort_order, Player.position_order(), Player.name)
        .all()
    )
    season_points = league.player_season_points()
    before = league.previous_gameweek(gameweek)
    previous = {p.player_id for p in league.squad_for(team, before)} if before else set()
    return render_template(
        "squad.html",
        gameweek=gameweek,
        players=players,
        teams=Team.query.order_by(Team.sort_order).all(),
        positions=POSITIONS,
        selected=selected,
        captain_id=captain_id,
        settings=settings,
        season_points=season_points,
        previous=sorted(previous),
    )


@bp.route("/leaderboard")
def leaderboard():
    table, latest = league.standings()
    return render_template("leaderboard.html", table=table, latest=latest)


@bp.route("/teams/<int:team_id>")
def fantasy_team(team_id):
    team = db.get_or_404(FantasyTeam, team_id)
    now = league.now_uk()
    locked = Gameweek.query.filter(Gameweek.deadline <= now).order_by(Gameweek.start_date).all()
    gw_id = request.args.get("gw", type=int)
    gameweek = next((gw for gw in locked if gw.id == gw_id), locked[-1] if locked else None)
    total, rows = league.gameweek_score(team, gameweek) if gameweek else (0, [])
    return render_template(
        "fantasy_team.html",
        team=team,
        gameweek=gameweek,
        locked=locked,
        total=total,
        rows=sorted(rows, key=lambda r: POSITIONS.index(r[0].player.position)),
    )


@bp.route("/players")
def players():
    season_points = league.player_season_points()
    all_players = Player.query.join(Team).filter(Player.active.is_(True)).order_by(Team.sort_order, Player.name).all()
    all_players.sort(key=lambda p: -season_points.get(p.id, 0))
    return render_template("players.html", players=all_players, season_points=season_points)


@bp.route("/fixtures")
def fixtures():
    gameweeks = Gameweek.ordered()
    return render_template("fixtures.html", gameweeks=gameweeks)


@bp.route("/rules")
def rules():
    return render_template("rules.html", rules=RULES_TABLE, settings=LeagueSettings.get())
