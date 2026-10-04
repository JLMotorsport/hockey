import os

import click
from flask import Flask, render_template
from flask_login import LoginManager
from flask_wtf import CSRFProtect

from .models import LeagueSettings, User, db, seed_teams

login_manager = LoginManager()
login_manager.login_view = "auth.login"
login_manager.login_message_category = "info"
csrf = CSRFProtect()


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def create_app(config=None):
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)
    database_url = os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(app.instance_path, 'fantasy.db')}")
    # Heroku/Render style URLs use the old postgres:// scheme.
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        SQLALCHEMY_DATABASE_URI=database_url,
        LEAGUE_NAME=os.environ.get("LEAGUE_NAME", "Felixstowe HC Fantasy Hockey"),
    )
    if config:
        app.config.update(config)

    db.init_app(app)
    login_manager.init_app(app)
    csrf.init_app(app)

    from . import admin, auth, main

    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)
    app.register_blueprint(admin.bp)

    with app.app_context():
        db.create_all()
        seed_teams()
        LeagueSettings.get()

    @app.context_processor
    def inject_globals():
        return {"league_name": app.config["LEAGUE_NAME"]}

    @app.errorhandler(403)
    @app.errorhandler(404)
    def error_page(error):
        return render_template("error.html", error=error), error.code

    register_cli(app)
    return app


def register_cli(app):
    @app.cli.command("sync-eh")
    def sync_eh():
        """Pull fixtures and scores from England Hockey."""
        from .eh_sync import sync_all

        for message in sync_all():
            click.echo(message)

    @app.cli.command("make-admin")
    @click.argument("email")
    def make_admin(email):
        """Give an existing account manager access."""
        user = User.query.filter_by(email=email.strip().lower()).first()
        if user is None:
            raise click.ClickException(f"No account with email {email}")
        user.is_admin = True
        db.session.commit()
        click.echo(f"{user.display_name} is now a manager.")

    @app.cli.command("seed-demo")
    def seed_demo():
        """Add made-up players so you can try the game out. Not for the real league."""
        from .demo import seed_demo_players

        click.echo(f"Added {seed_demo_players()} demo players.")
