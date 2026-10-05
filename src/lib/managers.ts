// Pure rules behind the managers' area: what needs attention, and why.
// No Supabase here so it can be unit tested.

import type { Position } from './scoring';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export interface Check {
  label: string;
  tone: Tone;
}

export interface MatchFacts {
  goals_for: number | null;
  goals_against: number | null;
  eh_fixture_id: string | null;
  lineup_imported_at: string | null;
  withheld_count: number;
  stats_locked: boolean;
  stats_complete: boolean;
}

export interface MatchEvidence {
  /** Pitchero published a team sheet for it. */
  pitchero: boolean;
  /** Someone is player of the match. */
  potm: boolean;
  /** Players in it still called "Name withheld". */
  unnamed: number;
}

export function isPlayed(f: Pick<MatchFacts, 'goals_for' | 'goals_against'>): boolean {
  return f.goals_for !== null && f.goals_against !== null;
}

/** Played, and nobody has ticked its stats as complete. */
export function needsChecking(f: MatchFacts): boolean {
  return isPlayed(f) && !f.stats_complete;
}

/** The pills on a match row: what's in, what's missing. */
export function matchChecks(f: MatchFacts, e: MatchEvidence): Check[] {
  if (!isPlayed(f)) return [{ label: 'Upcoming', tone: 'muted' }];
  const out: Check[] = [];
  if (f.lineup_imported_at) out.push({ label: 'Line-up', tone: 'ok' });
  else if (f.eh_fixture_id) out.push({ label: 'No line-up yet', tone: 'warn' });
  else out.push({ label: 'Manual', tone: 'muted' });
  out.push(
    e.pitchero ? { label: 'Pitchero', tone: 'ok' } : { label: 'No Pitchero', tone: 'muted' },
  );
  out.push(e.potm ? { label: 'POTM', tone: 'ok' } : { label: 'No POTM', tone: 'warn' });
  if (f.withheld_count > 0) out.push({ label: `${f.withheld_count} to add`, tone: 'bad' });
  if (e.unnamed > 0) out.push({ label: `${e.unnamed} withheld`, tone: 'bad' });
  if (f.stats_complete) out.push({ label: 'Complete', tone: 'ok' });
  if (f.stats_locked) out.push({ label: 'Locked', tone: 'muted' });
  return out;
}

export type MatchFilter = 'check' | 'withheld' | 'locked' | 'upcoming' | 'all';

export function matchesFilter(f: MatchFacts, e: MatchEvidence, filter: MatchFilter): boolean {
  switch (filter) {
    case 'check':
      return needsChecking(f);
    case 'withheld':
      return f.withheld_count > 0 || e.unnamed > 0;
    case 'locked':
      return f.stats_locked;
    case 'upcoming':
      return !isPlayed(f);
    default:
      return true;
  }
}

export interface PlayerFacts {
  position: Position;
  active: boolean;
  needs_review: boolean;
  position_confirmed: boolean;
  name_withheld: boolean;
}

/**
 * New from England Hockey, or still on the midfield default nobody has
 * confirmed. Squads are 2/5/5/3, so a wrong position affects everyone.
 */
export function needsPosition(p: PlayerFacts): boolean {
  return p.needs_review || (p.active && !p.position_confirmed && p.position === 'MID');
}

/** Sides with no active goalkeeper. */
export function sidesWithoutKeeper<S extends { id: number }>(
  sides: S[],
  players: (PlayerFacts & { side_id: number })[],
): S[] {
  const kept = new Set(
    players.filter((p) => p.active && !p.needs_review && p.position === 'GK').map((p) => p.side_id),
  );
  return sides.filter((s) => !kept.has(s.id));
}

export type PlayerFilter = 'position' | 'withheld' | 'suggested' | 'inactive' | 'all';

export function playersFilter(
  p: PlayerFacts,
  filter: PlayerFilter,
  hasSuggestion: boolean,
): boolean {
  switch (filter) {
    case 'position':
      return needsPosition(p);
    case 'withheld':
      return p.name_withheld;
    case 'suggested':
      return hasSuggestion;
    case 'inactive':
      return !p.active && !p.needs_review;
    default:
      return true;
  }
}
