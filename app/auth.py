from urllib.parse import urlparse

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from .models import FantasyTeam, User, db

bp = Blueprint("auth", __name__)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        name = request.form.get("display_name", "").strip()
        team_name = request.form.get("team_name", "").strip()
        password = request.form.get("password", "")

        errors = []
        if "@" not in email:
            errors.append("Enter a valid email address.")
        if not name:
            errors.append("Enter your name.")
        if not team_name:
            errors.append("Give your fantasy team a name.")
        if len(password) < 8:
            errors.append("Password must be at least 8 characters.")
        if User.query.filter_by(email=email).first():
            errors.append("An account with that email already exists.")
        if errors:
            for error in errors:
                flash(error, "error")
            return render_template("register.html", form=request.form), 400

        # The first account becomes the league manager.
        user = User(email=email, display_name=name, is_admin=User.query.count() == 0)
        user.set_password(password)
        db.session.add(user)
        db.session.add(FantasyTeam(user=user, name=team_name[:80]))
        db.session.commit()
        login_user(user)
        flash("Welcome! Now pick your squad.", "success")
        return redirect(url_for("main.squad"))
    return render_template("register.html", form={})


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        user = User.query.filter_by(email=email).first()
        if user and user.check_password(request.form.get("password", "")):
            login_user(user, remember=bool(request.form.get("remember")))
            next_url = request.args.get("next", "")
            # Only follow relative redirects.
            if not next_url or urlparse(next_url).netloc or not next_url.startswith("/"):
                next_url = url_for("main.dashboard")
            return redirect(next_url)
        flash("Wrong email or password.", "error")
        return render_template("login.html", email=email), 401
    return render_template("login.html", email="")


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return redirect(url_for("main.index"))


@bp.route("/account", methods=["GET", "POST"])
@login_required
def account():
    if request.method == "POST":
        team_name = request.form.get("team_name", "").strip()
        if team_name:
            current_user.fantasy_team.name = team_name[:80]
        new_password = request.form.get("new_password", "")
        if new_password:
            if not current_user.check_password(request.form.get("current_password", "")):
                flash("Current password is wrong.", "error")
                return redirect(url_for("auth.account"))
            if len(new_password) < 8:
                flash("New password must be at least 8 characters.", "error")
                return redirect(url_for("auth.account"))
            current_user.set_password(new_password)
        db.session.commit()
        flash("Account updated.", "success")
        return redirect(url_for("auth.account"))
    return render_template("account.html")
