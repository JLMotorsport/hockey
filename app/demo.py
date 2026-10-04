import random

from .models import Player, Team, db

FIRST = ["Alex", "Sam", "Jo", "Chris", "Charlie", "Robin", "Jamie", "Max", "Ellie", "Tom", "Hannah", "Ben"]
LAST = ["Smith", "Jones", "Taylor", "Brown", "Wilson", "Evans", "Clarke", "Hughes", "Wood", "Ward"]
# Per team: 1 GK, 4 DEF, 4 MID, 3 FWD.
SHAPE = ["GK"] + ["DEF"] * 4 + ["MID"] * 4 + ["FWD"] * 3


def seed_demo_players(seed=7):
    rng = random.Random(seed)
    added = 0
    for team in Team.query.order_by(Team.sort_order):
        if team.players:
            continue
        # Higher sides cost a bit more.
        base = 105 - team.sort_order % 4 * 15
        for position in SHAPE:
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)} ({team.short_name})"
            db.session.add(Player(name=name, position=position, team=team, price=base + rng.randint(-10, 10)))
            added += 1
    db.session.commit()
    return added
