// The Home screen's logic: is a gameweek live, how long to the deadline, and
// where you sit in each mini league. Pure so it can be unit tested.

import { defaultGameweek, type GameweekLike } from './gameweek';
import { leagueRows, movement, type TableRow } from './table';
import { fixtureCode } from './pickDisplay';
import type { FixtureLike } from './form';

/**
 * The gameweek being played, from its deadline until the Monday after (the
 * same window My Team opens on it), or undefined between gameweeks.
 */
export function liveGameweek<T extends GameweekLike>(gameweeks: T[], now = new Date()) {
  const gw = defaultGameweek(gameweeks, now);
  return gw && new Date(gw.deadline) <= now ? gw : undefined;
}

/** "in 1 day 22 hrs", "in 3 hrs 5 mins", "in 12 mins"; "" once it has passed. */
export function countdown(deadline: string, now = new Date()): string {
  const mins = Math.floor((new Date(deadline).getTime() - now.getTime()) / 60_000);
  if (mins < 0) return '';
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (days > 0) return `in ${unit(days, 'day')} ${unit(hrs, 'hr')}`;
  if (hrs > 0) return `in ${unit(hrs, 'hr')} ${unit(m, 'min')}`;
  return `in ${unit(m, 'min')}`;
}

/** 3 -> "3rd" */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Your place in a league and how it moved since the gameweek before. */
export function myPlace(
  rows: TableRow[],
  include: (userId: string) => boolean,
  userId: string,
): { rank: number; of: number; moved: number } | null {
  const league = leagueRows(rows, include);
  const me = league.find((r) => r.user_id === userId);
  if (!me) return null;
  return { rank: me.rank, of: league.length, moved: movement(league).get(userId) ?? 0 };
}

/** The gameweek's average and highest score across every team. */
export function weekSpread(rows: TableRow[]): { average: number; highest: number } {
  if (!rows.length) return { average: 0, highest: 0 };
  const sum = rows.reduce((n, r) => n + r.latest, 0);
  return {
    average: Math.round(sum / rows.length),
    highest: Math.max(...rows.map((r) => r.latest)),
  };
}

/**
 * A player's points aren't in yet: no appearance recorded and one of their
 * side's games this gameweek has no score.
 */
export function awaitingResult(
  fixtures: { side_id: number; gameweek_id: number; goals_for: number | null }[],
  sideId: number,
  gameweekId: number,
  appeared: boolean,
): boolean {
  if (appeared) return false;
  return fixtures.some(
    (f) => f.side_id === sideId && f.gameweek_id === gameweekId && f.goals_for === null,
  );
}

/**
 * What a live card shows instead of points while they aren't in: who the
 * player's usual side plays ("LOW (H)", "No game"), until a result or an
 * appearance is recorded. Null once there are points to show.
 */
export function pendingLabel(
  fixtures: (FixtureLike & { goals_for: number | null })[],
  sideId: number,
  gameweekId: number,
  appeared: boolean,
): string | null {
  if (appeared) return null;
  const games = fixtures.filter((f) => f.side_id === sideId && f.gameweek_id === gameweekId);
  if (games.length && !awaitingResult(fixtures, sideId, gameweekId, appeared)) return null;
  return fixtureCode(fixtures, sideId, gameweekId);
}
