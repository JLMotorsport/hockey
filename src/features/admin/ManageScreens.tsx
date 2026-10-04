import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Loading, Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { gameweekLabel, toUkInputValue } from '@/lib/format';
import {
  keys,
  useAdminUsers,
  useFixtures,
  useGameweeks,
  usePlayers,
  useSettings,
  useSides,
  type Player,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { parsePlayerLines } from '@/lib/players';
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

export function AdminPlayersScreen() {
  const players = usePlayers();
  const sides = useSides();
  const queryClient = useQueryClient();
  const [bulk, setBulk] = useState('');
  const n = useNotices();

  if (players.isLoading || sides.isLoading) return <Loading />;
  const sideList = sides.data ?? [];
  const sortOrder = new Map(sideList.map((s) => [s.id, s.sort_order]));
  const list = [...(players.data ?? [])].sort(
    (a, b) =>
      (sortOrder.get(a.side_id) ?? 0) - (sortOrder.get(b.side_id) ?? 0) ||
      POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
      a.name.localeCompare(b.name),
  );

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
      <section className="card">
        <h2>All players ({list.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pos</th>
              <th>Side</th>
              <th>Price</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <PlayerRow key={p.id} player={p} sides={sideList} onSaved={n.ok} onError={n.fail} />
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function PlayerRow({
  player,
  sides,
  onSaved,
  onError,
}: {
  player: Player;
  sides: { id: number; short_name: string }[];
  onSaved: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [row, setRow] = useState({ ...player, priceText: formatPrice(player.price) });
  const dirty =
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
  const [form, setForm] = useState<{ budget: string; max: string; transfers: string } | null>(null);
  if (settings.isLoading || !settings.data) return <Loading />;
  const s = settings.data;
  const f = form ?? {
    budget: formatPrice(s.budget),
    max: String(s.max_per_side),
    transfers: String(s.transfers_per_gameweek),
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const budget = parsePrice(f.budget, 10000);
    if (budget === null) {
      n.fail({ message: 'Budget should be a number like 100.0.' });
      return;
    }
    const { error } = await requireSupabase()
      .from('league_settings')
      .update({
        budget,
        max_per_side: Math.max(1, Number(f.max) || 1),
        transfers_per_gameweek: Math.max(0, Number(f.transfers) || 0),
      })
      .eq('id', 1);
    if (error) n.fail(error);
    else {
      n.ok('Settings saved.');
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    }
  }

  return (
    <section className="card max-w-md">
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
        <button className="btn">Save</button>
      </form>
    </section>
  );
}
