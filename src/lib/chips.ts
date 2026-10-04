// Chips: once-a-season boosts. play_chip() and squad_lineup() in
// supabase/migrations/0012_chips.sql enforce and score them; this only
// describes them and works out which are still available.

export type ChipKey = 'triple_captain' | 'rolling_subs' | 'wildcard' | 'team_bus';

export interface Chip {
  key: ChipKey;
  name: string;
  description: string;
}

export const CHIPS: Chip[] = [
  {
    key: 'triple_captain',
    name: 'Triple Captain',
    description:
      "Your captain scores 3x instead of 2x. If your captain doesn't play, your vice gets the 3x.",
  },
  {
    key: 'rolling_subs',
    name: 'Rolling Subs',
    description: 'All 15 players score this gameweek, your subs included.',
  },
  {
    key: 'wildcard',
    name: 'Wildcard',
    description:
      "Unlimited free transfers this gameweek, and the new squad stays. One before New Year, one after. Once played it can't be taken back.",
  },
  {
    key: 'team_bus',
    name: 'Team Bus',
    description:
      'Pick a Felixstowe side. Points your players earn playing for that side this gameweek count double (your captain too, on top of the armband).',
  },
];

export const chipName = (key: string) => CHIPS.find((c) => c.key === key)?.name ?? key;

export interface PlayedChip {
  chip: string;
  gameweek_id: number;
  side_id: number | null;
}

/** 1 for July to December, 2 for January to June (as season_half()). */
export function seasonHalf(date: string): 1 | 2 {
  return Number(date.slice(5, 7)) >= 7 ? 1 : 2;
}

export type ChipState =
  | { state: 'active'; sideId: number | null }
  | { state: 'used'; gameweekId: number }
  | { state: 'available' };

/** Where each chip stands for the gameweek being picked. */
export function chipStates(
  played: PlayedChip[],
  gameweeks: { id: number; start_date: string }[],
  nextGameweekId: number | undefined,
): Record<ChipKey, ChipState> {
  const startOf = new Map(gameweeks.map((g) => [g.id, g.start_date]));
  const nextStart = nextGameweekId ? startOf.get(nextGameweekId) : undefined;
  const out = {} as Record<ChipKey, ChipState>;
  for (const { key } of CHIPS) {
    const active = played.find((p) => p.chip === key && p.gameweek_id === nextGameweekId);
    const spent = played.find((p) => {
      if (p.chip !== key || p.gameweek_id === nextGameweekId) return false;
      if (key !== 'wildcard') return true;
      const start = startOf.get(p.gameweek_id);
      return Boolean(start && nextStart && seasonHalf(start) === seasonHalf(nextStart));
    });
    out[key] = active
      ? { state: 'active', sideId: active.side_id }
      : spent
        ? { state: 'used', gameweekId: spent.gameweek_id }
        : { state: 'available' };
  }
  return out;
}
