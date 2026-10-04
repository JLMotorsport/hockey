import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Loading, Notices, PosBadge, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { gameweekLabel, toUkInputValue } from '@/lib/format';
import {
  keys,
  useAdminUsers,
  useGameweekPricing,
  usePitcheroEvidence,
  useSeasonPoints,
  useFixtures,
  useGameweeks,
  usePlayers,
  useSettings,
  useSides,
  type Player,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { parsePlayerLines } from '@/lib/players';
import {
  suggestPositions,
  suggestWithheldNames,
  type Appearance,
  type NameSuggestion,
  type PitcheroRow,
} from '@/lib/pitcheroMatch';
import { ALL_FORMATIONS } from '@/lib/formation';
import { WithheldEvidence } from './WithheldEvidence';
import { WithheldName } from './WithheldName';
import { formatPrice, parsePrice } from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';

function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  return {
    notices,
    ok: (text: string) => setNotices([{ kind: 'success', text }]),
    fail: (error: unknown) =>
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text }))),
    set: setNotices,
  };
}

function PricesCard({ onDone }: { onDone: (notices: Notice[]) => void }) {
  const queryClient = useQueryClient();
  const pricing = useGameweekPricing();
  const gameweeks = useGameweeks();
  const [busy, setBusy] = useState(false);
  const started = (pricing.data?.length ?? 0) > 0;
  const all = gameweeks.data ?? [];
  const lastPriced = all.filter((g) => pricing.data?.some((p) => p.gameweek_id === g.id)).at(-1);

  async function run(kind: 'start' | 'weekly') {
    if (
      kind === 'start' &&
      !window.confirm(
        started
          ? 'Reset every price from points so far? This replaces the current prices, including any you set by hand.'
          : "Set every player's price from their points so far?",
      )
    ) {
      return;
    }
    setBusy(true);
    const db = requireSupabase();
    const result =
      kind === 'start'
        ? await db.rpc('set_prices_from_points')
        : await db.rpc('apply_due_price_changes');
    setBusy(false);
    if (result.error) {
      onDone(errorLines(result.error).map((text) => ({ kind: 'error', text })));
      return;
    }
    const data = result.data as number | { weeks?: number; changes?: number };
    onDone([
      {
        kind: 'success',
        text:
          typeof data === 'number'
            ? `Priced ${data} players from their points. Prices now move each week with form.`
            : data.weeks
              ? `${data.changes} price changes over ${data.weeks} gameweek(s).`
              : "No price changes due yet. They run once a gameweek's weekend is over.",
      },
    ]);
    await queryClient.invalidateQueries();
  }

  return (
    <section className="card">
      <h2>Prices</h2>
      <p className="muted text-sm">
        Starting prices come from each player&apos;s total points so far, everyone ranked together,
        from 4.0m to 10.0m: more points always means a higher price. After each gameweek, players
        who played move up or down by up to 0.3m depending on how they scored against
        everyone&apos;s average that week. That runs automatically with the sync.
      </p>
      <p className="mt-2 text-sm font-semibold">
        {started
          ? `Weekly changes are on${lastPriced ? `, done up to ${gameweekLabel(lastPriced, all)}` : ''}.`
          : 'Prices have not been set from points yet.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => void run('start')}>
          {started ? 'Reset prices from points' : 'Set prices from points'}
        </button>
        {started && (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => void run('weekly')}
          >
            Apply weekly changes now
          </button>
        )}
      </div>
    </section>
  );
}

/** Positions players usually line up in on Pitchero, to apply in bulk. */
function PositionsCard({
  players,
  appearances,
  sheets,
  onDone,
}: {
  players: Player[];
  appearances: Appearance[];
  sheets: PitcheroRow[];
  onDone: (notices: Notice[]) => void;
}) {
  const queryClient = useQueryClient();
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const byId = new Map(players.map((p) => [p.id, p]));
  const changes = suggestPositions(appearances, sheets)
    .filter((s) => {
      const p = byId.get(s.player_id);
      return p && !p.position_confirmed && p.position !== s.position;
    })
    .sort((a, b) => byId.get(a.player_id)!.name.localeCompare(byId.get(b.player_id)!.name));
  if (!changes.length) return null;
  const chosen = changes.filter((c) => !skip.has(c.player_id));

  async function apply() {
    setBusy(true);
    const db = requireSupabase();
    const results = await Promise.all(
      chosen.map((c) => db.from('players').update({ position: c.position }).eq('id', c.player_id)),
    );
    setBusy(false);
    const failed = results.find((r) => r.error);
    onDone(
      failed?.error
        ? errorLines(failed.error).map((text) => ({ kind: 'error', text }))
        : [{ kind: 'success', text: `Updated ${chosen.length} position(s) from Pitchero.` }],
    );
    await queryClient.invalidateQueries({ queryKey: keys.players });
  }

  /** Pitchero has it wrong: keep the current position and stop suggesting. */
  async function reject(ids: number[]) {
    setBusy(true);
    const { error } = await requireSupabase()
      .from('players')
      .update({ position_confirmed: true })
      .in('id', ids);
    setBusy(false);
    if (error) onDone(errorLines(error).map((text) => ({ kind: 'error', text })));
    await queryClient.invalidateQueries({ queryKey: keys.players });
  }

  return (
    <section className="card">
      <h2>Positions from Pitchero ({changes.length})</h2>
      <p className="muted text-sm">
        Where each player most often lines up on Pitchero team sheets (wingers count as midfield).
        Untick any to leave for now, or reject the ones Pitchero has wrong and they won&apos;t be
        suggested again. Changing a position by hand also stops suggestions for that player.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Use</th>
            <th>Player</th>
            <th>Now</th>
            <th>Pitchero</th>
            <th>Seen as</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const p = byId.get(c.player_id)!;
            return (
              <tr key={c.player_id}>
                <td>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#d91414]"
                    aria-label={`Use Pitchero position for ${p.name}`}
                    checked={!skip.has(c.player_id)}
                    onChange={(e) => {
                      const next = new Set(skip);
                      if (e.target.checked) next.delete(c.player_id);
                      else next.add(c.player_id);
                      setSkip(next);
                    }}
                  />
                </td>
                <td>{p.name}</td>
                <td>
                  <PosBadge position={p.position} />
                </td>
                <td>
                  <PosBadge position={c.position} />
                </td>
                <td className="muted text-xs">{c.evidence}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy}
                    aria-label={`Reject Pitchero position for ${p.name}`}
                    onClick={() => void reject([c.player_id])}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="btn mt-3"
        disabled={busy || !chosen.length}
        onClick={() => void apply()}
      >
        {busy ? 'Updating' : `Apply ${chosen.length} position(s)`}
      </button>
      {skip.size > 0 && (
        <button
          type="button"
          className="btn btn-quiet mt-3 ml-2"
          disabled={busy}
          onClick={() => void reject([...skip]).then(() => setSkip(new Set()))}
        >
          Reject {skip.size} unticked
        </button>
      )}
    </section>
  );
}

export function AdminPlayersScreen() {
  const players = usePlayers();
  const evidence = usePitcheroEvidence();
  const sides = useSides();
  const queryClient = useQueryClient();
  const [bulk, setBulk] = useState('');
  const n = useNotices();

  if (players.isLoading || sides.isLoading) return <Loading />;
  const sideList = sides.data ?? [];
  const sortOrder = new Map(sideList.map((s) => [s.id, s.sort_order]));
  const sorted = [...(players.data ?? [])].sort(
    (a, b) =>
      (sortOrder.get(a.side_id) ?? 0) - (sortOrder.get(b.side_id) ?? 0) ||
      POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
      a.name.localeCompare(b.name),
  );
  const fresh = sorted.filter((p) => p.needs_review);
  const list = sorted.filter((p) => !p.needs_review);
  const unnamed = sorted.filter((p) => p.name_withheld);
  const nameSuggestions = evidence.data
    ? suggestWithheldNames(
        evidence.data.appearances,
        evidence.data.sheets,
        sorted.filter((p) => !p.name_withheld).map((p) => p.name),
      )
    : new Map<number, NameSuggestion[]>();

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    const { rows, problems } = parsePlayerLines(bulk, sideList);
    const out: Notice[] = problems.map((text) => ({ kind: 'error', text }));
    if (rows.length) {
      const { error } = await requireSupabase().from('players').insert(rows);
      if (error) out.unshift(...errorLines(error).map((text): Notice => ({ kind: 'error', text })));
      else {
        out.unshift({ kind: 'success', text: `Added ${rows.length} player(s).` });
        setBulk('');
        await queryClient.invalidateQueries({ queryKey: keys.players });
      }
    }
    n.set(out);
  }

  return (
    <>
      <PricesCard onDone={n.set} />
      {evidence.data && (
        <PositionsCard
          players={sorted}
          appearances={evidence.data.appearances}
          sheets={evidence.data.sheets}
          onDone={n.set}
        />
      )}
      <section className="card">
        <h2>Add players</h2>
        <p className="muted text-sm">
          One per line: <code>Name, Position, Side, Price</code>. Position is GK, DEF, MID or FWD.
          Side is the short name ({sideList.map((s) => s.short_name).join(', ')}).
        </p>
        <Notices items={n.notices} />
        <form onSubmit={(e) => void addBulk(e)}>
          <textarea
            className="input min-h-[120px] py-2"
            aria-label="Players to add"
            placeholder={'Jo Bloggs, MID, M1, 8.5\nSam Smith, GK, W2, 6.0'}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <button className="btn mt-2">Add</button>
        </form>
      </section>
      {unnamed.length > 0 && (
        <section className="card border-brand/40">
          <h2>Names to correct ({unnamed.length})</h2>
          <p className="muted text-sm">
            These players keep their GMS profile private, so England Hockey shows &quot;Name
            withheld&quot;. Their goals and cards still count. Each one lists the matches they
            played, the shirt they wore and what they did, to help you work out who it is. Type the
            real name once, or merge them into a player you already added.
          </p>
          <ul className="divide-y divide-line">
            {unnamed.map((p) => (
              <li key={p.id} className="py-3">
                <span className="font-semibold">{p.name}</span>
                <WithheldEvidence
                  playerId={p.id}
                  sideName={(id) => sideList.find((x) => x.id === id)?.short_name ?? ''}
                />
                <WithheldName
                  player={p}
                  players={players.data ?? []}
                  suggestions={nameSuggestions.get(p.id) ?? []}
                  onError={(l) => n.set(l.map((text) => ({ kind: 'error', text })))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {fresh.length > 0 && (
        <section className="card border-accent">
          <h2>New from England Hockey ({fresh.length})</h2>
          <p className="muted text-sm">
            These players appeared in a line-up and their points are already counting. Set each
            one&apos;s position (goalkeepers are marked already) and price; changed rows tick
            themselves. Then press Save to make the ticked players pickable.
          </p>
          <NewPlayersTable players={fresh} sides={sideList} onSaved={n.ok} onError={n.fail} />
        </section>
      )}
      <section className="card">
        <h2>All players ({list.length})</h2>
        <PlayerTable players={list} sides={sideList} onSaved={n.ok} onError={n.fail} />
      </section>
    </>
  );
}

interface NewRow {
  position: Position;
  priceText: string;
  side_id: number;
  ready: boolean;
}

/** New players from England Hockey: edit many, save once. */
function NewPlayersTable({
  players,
  sides,
  onSaved,
  onError,
}: {
  players: Player[];
  sides: { id: number; short_name: string }[];
  onSaved: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const points = useSeasonPoints();
  const [rows, setRows] = useState<Record<number, NewRow>>(() =>
    Object.fromEntries(
      players.map((p) => [
        p.id,
        { position: p.position, priceText: formatPrice(p.price), side_id: p.side_id, ready: false },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const row = (p: Player): NewRow =>
    rows[p.id] ?? {
      position: p.position,
      priceText: formatPrice(p.price),
      side_id: p.side_id,
      ready: false,
    };
  const update = (p: Player, patch: Partial<NewRow>) =>
    setRows({ ...rows, [p.id]: { ...row(p), ready: true, ...patch } });
  const ready = players.filter((p) => row(p).ready);

  async function saveReady() {
    const bad = ready.find((p) => parsePrice(row(p).priceText) === null);
    if (bad) {
      onError({ message: `Check the price for ${bad.name} (a number like 6.5).` });
      return;
    }
    setSaving(true);
    const db = requireSupabase();
    const results = await Promise.all(
      ready.map((p) =>
        db
          .from('players')
          .update({
            position: row(p).position,
            side_id: row(p).side_id,
            price: parsePrice(row(p).priceText)!,
            active: true,
            needs_review: false,
          })
          .eq('id', p.id),
      ),
    );
    setSaving(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) onError(failed.error);
    else onSaved(`Saved ${ready.length} player(s). They can now be picked.`);
    await queryClient.invalidateQueries({ queryKey: keys.players });
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Save</th>
            <th>Name</th>
            <th>Pos</th>
            <th>Side</th>
            <th>Price</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const r = row(p);
            return (
              <tr key={p.id} className={r.ready ? 'bg-brand/5' : ''}>
                <td>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#d91414]"
                    aria-label={`Save ${p.name}`}
                    checked={r.ready}
                    onChange={(e) => update(p, { ready: e.target.checked })}
                  />
                </td>
                <td className="whitespace-nowrap">{p.name}</td>
                <td>
                  <div className="flex gap-1" role="group" aria-label={`Position for ${p.name}`}>
                    {POSITIONS.map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        aria-pressed={r.position === pos}
                        onClick={() => update(p, { position: pos })}
                        className={`min-h-[36px] min-w-[44px] rounded-lg font-display text-sm font-bold ${r.position === pos ? 'bg-brand text-white' : 'bg-paper text-ink-soft ring-1 ring-line'}`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <select
                    className="input-inline"
                    aria-label={`Side for ${p.name}`}
                    value={r.side_id}
                    onChange={(e) => update(p, { side_id: Number(e.target.value) })}
                  >
                    {sides.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.short_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input-inline w-16"
                    inputMode="decimal"
                    aria-label={`Price for ${p.name}`}
                    value={r.priceText}
                    onChange={(e) => update(p, { priceText: e.target.value })}
                  />
                </td>
                <td className="num font-semibold">{points.data?.get(p.id) ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sticky bottom-20 mt-3 flex justify-end sm:bottom-4">
        <button
          type="button"
          className="btn shadow-lg"
          disabled={!ready.length || saving}
          onClick={() => void saveReady()}
        >
          {saving ? 'Saving' : `Save ${ready.length} ticked`}
        </button>
      </div>
    </>
  );
}

function PlayerTable({
  players,
  sides,
  onSaved,
  onError,
}: {
  players: Player[];
  sides: { id: number; short_name: string }[];
  onSaved: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const points = useSeasonPoints();
  const [sortByPoints, setSortByPoints] = useState(false);
  const list = sortByPoints
    ? [...players].sort((a, b) => (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0))
    : players;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Pos</th>
          <th>Side</th>
          <th>Price</th>
          <th className="num">
            <button
              type="button"
              className="font-display font-bold uppercase underline-offset-2 hover:underline"
              onClick={() => setSortByPoints(!sortByPoints)}
              title="Sort by season points"
            >
              Pts{sortByPoints ? ' ▼' : ''}
            </button>
          </th>
          <th>Active</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <PlayerRow
            // Re-mount when the saved row changes (e.g. prices reset), so the
            // inputs show the new values.
            key={`${p.id}-${p.needs_review}-${p.price}-${p.position}-${p.side_id}-${p.active}-${p.name}`}
            points={points.data?.get(p.id) ?? 0}
            player={p}
            sides={sides}
            onSaved={onSaved}
            onError={onError}
          />
        ))}
      </tbody>
    </table>
  );
}

function PlayerRow({
  player,
  points,
  sides,
  onSaved,
  onError,
}: {
  player: Player;
  points: number;
  sides: { id: number; short_name: string }[];
  onSaved: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  // New players become pickable when first saved, so allocating a position is all it takes.
  const [row, setRow] = useState({
    ...player,
    active: player.needs_review ? true : player.active,
    priceText: formatPrice(player.price),
  });
  const dirty =
    player.needs_review ||
    row.name !== player.name ||
    row.position !== player.position ||
    row.side_id !== player.side_id ||
    row.active !== player.active ||
    row.priceText !== formatPrice(player.price);

  async function save() {
    const price = parsePrice(row.priceText);
    if (price === null || !row.name.trim()) {
      onError({ message: 'Name and a price like 7.5 are required.' });
      return;
    }
    const { error } = await requireSupabase()
      .from('players')
      .update({
        name: row.name.trim(),
        position: row.position,
        side_id: row.side_id,
        price,
        active: row.active,
        needs_review: false,
      })
      .eq('id', player.id);
    if (error) onError(error);
    else {
      onSaved(`Saved ${row.name}.`);
      await queryClient.invalidateQueries({ queryKey: keys.players });
    }
  }

  return (
    <tr>
      <td>
        <input
          className="input-inline w-full min-w-[8rem]"
          aria-label="Name"
          value={row.name}
          onChange={(e) => setRow({ ...row, name: e.target.value })}
        />
      </td>
      <td>
        <select
          className="input-inline"
          aria-label="Position"
          value={row.position}
          onChange={(e) => setRow({ ...row, position: e.target.value as Position })}
        >
          {POSITIONS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className="input-inline"
          aria-label="Side"
          value={row.side_id}
          onChange={(e) => setRow({ ...row, side_id: Number(e.target.value) })}
        >
          {sides.map((s) => (
            <option key={s.id} value={s.id}>
              {s.short_name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="input-inline w-16"
          inputMode="decimal"
          aria-label="Price"
          value={row.priceText}
          onChange={(e) => setRow({ ...row, priceText: e.target.value })}
        />
      </td>
      <td className="num font-semibold">{points}</td>
      <td>
        <input
          type="checkbox"
          className="h-5 w-5"
          aria-label="Active"
          checked={row.active}
          onChange={(e) => setRow({ ...row, active: e.target.checked })}
        />
      </td>
      <td>
        <button type="button" className="btn btn-sm" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
      </td>
    </tr>
  );
}

export function AdminDeadlinesScreen() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const queryClient = useQueryClient();
  const n = useNotices();
  const [edits, setEdits] = useState<Record<number, string>>({});
  if (gameweeks.isLoading) return <Loading />;
  const all = gameweeks.data ?? [];

  async function save(id: number) {
    const value = edits[id];
    if (!value) return;
    const { error } = await requireSupabase().rpc('set_deadline', {
      p_gameweek_id: id,
      p_deadline: value,
    });
    if (error) n.fail(error);
    else {
      n.ok('Deadline updated.');
      await queryClient.invalidateQueries({ queryKey: keys.gameweeks });
    }
  }

  return (
    <section className="card">
      <p className="muted text-sm">
        Gameweeks are created automatically from fixture dates, one per weekend. Deadlines default
        to Saturday 10:00 UK time.
      </p>
      <Notices items={n.notices} />
      <table className="table">
        <tbody>
          {all.map((gw) => (
            <tr key={gw.id}>
              <td className="whitespace-nowrap">{gameweekLabel(gw, all)}</td>
              <td className="muted">
                {(fixtures.data ?? []).filter((f) => f.gameweek_id === gw.id).length} fixtures
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <input
                    className="input-inline"
                    type="datetime-local"
                    aria-label={`Deadline for ${gameweekLabel(gw, all)}`}
                    value={edits[gw.id] ?? toUkInputValue(gw.deadline)}
                    onChange={(e) => setEdits({ ...edits, [gw.id]: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!edits[gw.id]}
                    onClick={() => void save(gw.id)}
                  >
                    Save
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AdminSidesScreen() {
  const sides = useSides();
  const queryClient = useQueryClient();
  const n = useNotices();
  const [draft, setDraft] = useState({ name: '', short_name: '', eh_slug: '' });
  if (sides.isLoading) return <Loading />;

  async function saveSide(
    id: number | null,
    values: { name: string; short_name: string; eh_slug: string },
  ) {
    const row = {
      name: values.name.trim(),
      short_name: values.short_name.trim(),
      eh_slug: values.eh_slug.trim() || null,
    };
    if (!row.name || !row.short_name) {
      n.fail({ message: 'Name and short name are required.' });
      return;
    }
    const db = requireSupabase();
    const { error } = id
      ? await db.from('sides').update(row).eq('id', id)
      : await db.from('sides').insert({ ...row, sort_order: sides.data?.length ?? 0 });
    if (error) n.fail(error);
    else {
      n.ok(`Saved ${row.name}.`);
      if (!id) setDraft({ name: '', short_name: '', eh_slug: '' });
      await queryClient.invalidateQueries({ queryKey: keys.sides });
    }
  }

  return (
    <section className="card">
      <p className="muted text-sm">
        The England Hockey slug is the last part of the side&apos;s page address, e.g.
        englandhockey.co.uk/teams/
        <strong>felixstowe-1-mens</strong>. Leave it blank for sides that aren&apos;t on England
        Hockey.
      </p>
      <Notices items={n.notices} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Short</th>
            <th>England Hockey slug</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(sides.data ?? []).map((s) => (
            <SideRow key={s.id} side={s} onSave={(v) => void saveSide(s.id, v)} />
          ))}
          <tr>
            <td>
              <input
                className="input-inline w-full"
                placeholder="e.g. Mixed"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </td>
            <td>
              <input
                className="input-inline w-16"
                placeholder="MX"
                value={draft.short_name}
                onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
              />
            </td>
            <td>
              <input
                className="input-inline w-full"
                placeholder="optional"
                value={draft.eh_slug}
                onChange={(e) => setDraft({ ...draft, eh_slug: e.target.value })}
              />
            </td>
            <td>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void saveSide(null, draft)}
              >
                Add side
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function SideRow({
  side,
  onSave,
}: {
  side: { name: string; short_name: string; eh_slug: string | null };
  onSave: (v: { name: string; short_name: string; eh_slug: string }) => void;
}) {
  const [v, setV] = useState({
    name: side.name,
    short_name: side.short_name,
    eh_slug: side.eh_slug ?? '',
  });
  return (
    <tr>
      <td>
        <input
          className="input-inline w-full"
          aria-label="Name"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
      </td>
      <td>
        <input
          className="input-inline w-16"
          aria-label="Short name"
          value={v.short_name}
          onChange={(e) => setV({ ...v, short_name: e.target.value })}
        />
      </td>
      <td>
        <input
          className="input-inline w-full"
          aria-label="England Hockey slug"
          value={v.eh_slug}
          onChange={(e) => setV({ ...v, eh_slug: e.target.value })}
        />
      </td>
      <td>
        <button type="button" className="btn btn-sm" onClick={() => onSave(v)}>
          Save
        </button>
      </td>
    </tr>
  );
}

export function AdminUsersScreen() {
  const { session } = useAuth();
  const users = useAdminUsers();
  const queryClient = useQueryClient();
  const n = useNotices();
  if (users.isLoading) return <Loading />;

  async function toggle(id: string, value: boolean, name: string) {
    const { error } = await requireSupabase().rpc('set_admin', { p_user: id, p_value: value });
    if (error) n.fail(error);
    else {
      n.ok(`${name} is ${value ? 'now' : 'no longer'} a manager.`);
      await queryClient.invalidateQueries({ queryKey: keys.adminUsers });
    }
  }

  return (
    <section className="card">
      <Notices items={n.notices} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Fantasy team</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.display_name}</td>
              <td>{u.email}</td>
              <td>{u.team_name}</td>
              <td>{u.is_admin ? 'Manager' : 'Player'}</td>
              <td>
                {u.id !== session?.user.id && (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => void toggle(u.id, !u.is_admin, u.display_name)}
                  >
                    {u.is_admin ? 'Remove manager' : 'Make manager'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AdminSettingsScreen() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const n = useNotices();
  const [form, setForm] = useState<{
    budget: string;
    max: string;
    transfers: string;
    formations: string[];
  } | null>(null);
  if (settings.isLoading || !settings.data) return <Loading />;
  const s = settings.data;
  const f = form ?? {
    budget: formatPrice(s.budget),
    max: String(s.max_per_side),
    transfers: String(s.transfers_per_gameweek),
    formations: s.formations,
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const budget = parsePrice(f.budget, 10000);
    if (budget === null) {
      n.fail({ message: 'Budget should be a number like 100.0.' });
      return;
    }
    if (!f.formations.length) {
      n.fail({ message: 'Allow at least one formation.' });
      return;
    }
    const { error } = await requireSupabase()
      .from('league_settings')
      .update({
        budget,
        max_per_side: Math.max(1, Number(f.max) || 1),
        transfers_per_gameweek: Math.max(0, Number(f.transfers) || 0),
        formations: ALL_FORMATIONS.filter((x) => f.formations.includes(x)),
      })
      .eq('id', 1);
    if (error) n.fail(error);
    else {
      n.ok('Settings saved.');
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    }
  }

  return (
    <section className="card max-w-xl">
      <Notices items={n.notices} />
      <form onSubmit={(e) => void save(e)}>
        <label className="field">
          Budget (m)
          <input
            className="input"
            inputMode="decimal"
            value={f.budget}
            onChange={(e) => setForm({ ...f, budget: e.target.value })}
          />
        </label>
        <label className="field">
          Max players from one side
          <input
            className="input"
            type="number"
            min={1}
            value={f.max}
            onChange={(e) => setForm({ ...f, max: e.target.value })}
          />
        </label>
        <label className="field">
          Transfers per gameweek
          <input
            className="input"
            type="number"
            min={0}
            value={f.transfers}
            onChange={(e) => setForm({ ...f, transfers: e.target.value })}
          />
        </label>
        <fieldset className="mb-4">
          <legend className="field mb-1">
            Allowed formations (defenders-midfielders-forwards)
          </legend>
          <div className="flex flex-wrap gap-2">
            {ALL_FORMATIONS.map((x) => {
              const on = f.formations.includes(x);
              return (
                <button
                  key={x}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setForm({
                      ...f,
                      formations: on ? f.formations.filter((y) => y !== x) : [...f.formations, x],
                    })
                  }
                  className={`min-h-[40px] rounded-full px-4 font-display text-lg font-extrabold tabular-nums ${on ? 'bg-brand text-white' : 'bg-paper text-ink-soft ring-1 ring-line'}`}
                >
                  {x}
                </button>
              );
            })}
          </div>
          <p className="muted mt-2 text-sm">
            Squads already saved in a formation you switch off stay as they are until their owner
            next changes them.
          </p>
        </fieldset>
        <button className="btn">Save</button>
      </form>
    </section>
  );
}
