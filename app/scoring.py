"""Fantasy points rules.

Everything a player scores comes from a Performance row (entered by a manager)
plus the fixture score (synced from England Hockey or entered by hand).
"""

APPEARANCE = 1
GOAL = {"GK": 6, "DEF": 6, "MID": 5, "FWD": 4}
ASSIST = 3
CLEAN_SHEET = {"GK": 4, "DEF": 4, "MID": 1, "FWD": 0}
# GK and DEF lose a point for every 2 goals conceded.
CONCEDED_PER_POINT = 2
CONCEDED_POSITIONS = ("GK", "DEF")
TEAM_WIN = 2
PLAYER_OF_MATCH = 3
GREEN_CARD = -1
YELLOW_CARD = -2
RED_CARD = -4
CAPTAIN_MULTIPLIER = 2

RULES_TABLE = [
    ("Playing in a match", f"{APPEARANCE}"),
    ("Goal (GK / DEF)", f"{GOAL['DEF']}"),
    ("Goal (MID)", f"{GOAL['MID']}"),
    ("Goal (FWD)", f"{GOAL['FWD']}"),
    ("Assist", f"{ASSIST}"),
    ("Clean sheet (GK / DEF)", f"{CLEAN_SHEET['DEF']}"),
    ("Clean sheet (MID)", f"{CLEAN_SHEET['MID']}"),
    ("Every 2 goals conceded (GK / DEF)", "-1"),
    ("Team win", f"{TEAM_WIN}"),
    ("Player of the match", f"{PLAYER_OF_MATCH}"),
    ("Green card", f"{GREEN_CARD}"),
    ("Yellow card", f"{YELLOW_CARD}"),
    ("Red card", f"{RED_CARD}"),
    ("Captain", f"x{CAPTAIN_MULTIPLIER}"),
]


def breakdown(performance):
    """List of (reason, points) for one stat line."""
    position = performance.player.position
    fixture = performance.fixture
    items = [("Played", APPEARANCE)]

    if performance.goals:
        items.append((f"{performance.goals} goal(s)", performance.goals * GOAL[position]))
    if performance.assists:
        items.append((f"{performance.assists} assist(s)", performance.assists * ASSIST))

    if fixture.has_result:
        if fixture.goals_against == 0 and CLEAN_SHEET[position]:
            items.append(("Clean sheet", CLEAN_SHEET[position]))
        if position in CONCEDED_POSITIONS and fixture.goals_against >= CONCEDED_PER_POINT:
            items.append((f"{fixture.goals_against} conceded", -(fixture.goals_against // CONCEDED_PER_POINT)))
        if fixture.goals_for > fixture.goals_against:
            items.append(("Team win", TEAM_WIN))

    if performance.player_of_match:
        items.append(("Player of the match", PLAYER_OF_MATCH))
    if performance.green_cards:
        items.append((f"{performance.green_cards} green card(s)", performance.green_cards * GREEN_CARD))
    if performance.yellow_cards:
        items.append((f"{performance.yellow_cards} yellow card(s)", performance.yellow_cards * YELLOW_CARD))
    if performance.red_cards:
        items.append((f"{performance.red_cards} red card(s)", performance.red_cards * RED_CARD))
    return items


def performance_points(performance):
    return sum(points for _, points in breakdown(performance))
