import { POSITIONS, type Position } from './scoring';
import { parsePrice } from './squad';

/** Parse "Name, Position, Side, Price" lines from the manager's bulk add box. */
export function parsePlayerLines(
  text: string,
  sides: { id: number; name: string; short_name: string }[],
): {
  rows: { name: string; position: Position; side_id: number; price: number }[];
  problems: string[];
} {
  const lookup = new Map<string, number>();
  for (const s of sides) {
    lookup.set(s.short_name.toLowerCase(), s.id);
    lookup.set(s.name.toLowerCase(), s.id);
  }
  const rows: { name: string; position: Position; side_id: number; price: number }[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length !== 4) {
      problems.push(`Line ${i + 1}: expected "Name, Position, Side, Price".`);
      return;
    }
    const [name, pos, side, price] = parts as [string, string, string, string];
    const position = pos.toUpperCase() as Position;
    const sideId = lookup.get(side.toLowerCase());
    const tenths = parsePrice(price);
    if (!name || !POSITIONS.includes(position) || sideId === undefined) {
      problems.push(`Line ${i + 1}: check the position (${POSITIONS.join('/')}) and side.`);
    } else if (tenths === null) {
      problems.push(`Line ${i + 1}: price should be a number like 7.5.`);
    } else {
      rows.push({ name, position, side_id: sideId, price: tenths });
    }
  });
  return { rows, problems };
}
