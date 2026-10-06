// What the FPL-style player cards show: a surname and a short line of data
// (opponent code, price, form...). Pure so it can be unit tested.

import { opponentName, type FixtureLike } from './form';

/** "Lowestoft Railway 1" -> "LOW"; "Ipswich-East Suffolk 3" -> "IES"; "City of Norwich" -> "NOR". */
export function opponentCode(name: string): string {
  const known = opponentName(name);
  const special = /^(IES|UEA)\b/.exec(known);
  if (special) return special[1]!;
  const first =
    known
      .replace(/^city of /i, '')
      .split(/[\s-]+/)
      .find((w) => /[a-z]/i.test(w)) ?? known;
  return first
    .replace(/[^a-z]/gi, '')
    .slice(0, 3)
    .toUpperCase();
}

/** "LOW (H)", "2 games" or "No game" for a side in a gameweek. */
export function fixtureCode(fixtures: FixtureLike[], sideId: number, gameweekId: number): string {
  const games = fixtures.filter((f) => f.side_id === sideId && f.gameweek_id === gameweekId);
  if (!games.length) return 'No game';
  if (games.length > 1) return `${games.length} games`;
  const f = games[0]!;
  return `${opponentCode(f.opponent)} (${f.is_home ? 'H' : 'A'})`;
}

/** The surname alone, with an initial only where two players share it. */
export function cardNames(names: { id: number; name: string }[]): Map<number, string> {
  const surname = (name: string) => {
    if (/^name withheld/i.test(name)) return 'Withheld';
    return name.trim().split(/\s+/).at(-1) ?? name;
  };
  const counts = new Map<string, number>();
  for (const p of names) counts.set(surname(p.name), (counts.get(surname(p.name)) ?? 0) + 1);
  return new Map(
    names.map((p) => {
      const s = surname(p.name);
      const first = p.name.trim().split(/\s+/)[0] ?? '';
      return [p.id, (counts.get(s) ?? 0) > 1 && first !== s ? `${first[0]}. ${s}` : s];
    }),
  );
}

/** A price change in tenths as "+0.2m", "-0.1m" or "0.0m". */
export function priceChange(tenths: number | undefined): string {
  const t = tenths ?? 0;
  return `${t > 0 ? '+' : t < 0 ? '-' : ''}${(Math.abs(t) / 10).toFixed(1)}m`;
}

export type PlayerData = 'opponent' | 'price' | 'change' | 'form' | 'gw' | 'total' | 'ownership';

export const PLAYER_DATA: { key: PlayerData; label: string; help: string }[] = [
  { key: 'opponent', label: 'Opponent', help: 'Who their side plays, e.g. IPS (A)' },
  { key: 'price', label: 'Current Price', help: 'e.g. 6.5m' },
  { key: 'change', label: 'Price Change', help: 'Last move, e.g. +0.2m' },
  { key: 'form', label: 'Form', help: 'Average points, last 3 games' },
  { key: 'gw', label: 'GW Points', help: 'Points last gameweek' },
  { key: 'total', label: 'Total Points', help: 'This season' },
  { key: 'ownership', label: 'Ownership', help: 'Managers who had them last gameweek' },
];
