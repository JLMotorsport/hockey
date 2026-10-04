import { toPng } from 'html-to-image';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pitch, type PitchSlot } from '@/components/Pitch';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formationOf, pitchRows } from '@/lib/formation';
import { formatShortDate, gameweekLabel, shortName } from '@/lib/format';
import {
  lockedGameweeks,
  useGameweeks,
  useGameweekScores,
  useScoredGameweeks,
  usePlayers,
  useSettings,
  useSides,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { teamOfTheWeek, type Scorer } from '@/lib/teamOfWeek';

export function TeamOfWeekScreen() {
  const [params, setParams] = useSearchParams();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const settings = useSettings();
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const scored = useScoredGameweeks();
  const all = gameweeks.data ?? [];
  // Only gameweeks that have been played; the newest by default.
  const locked = lockedGameweeks(all).filter((g) => scored.data?.has(g.id));
  const wanted = Number(params.get('gw'));
  const gameweek = locked.find((g) => g.id === wanted) ?? locked.at(-1);
  const scores = useGameweekScores(gameweek?.id);

  if (
    gameweeks.isLoading ||
    scored.isLoading ||
    players.isLoading ||
    sides.isLoading ||
    settings.isLoading
  ) {
    return <Loading />;
  }
  if (!gameweek) {
    return (
      <>
        <h1>Team of the week</h1>
        <p className="muted">The first team of the week appears once a gameweek has been played.</p>
      </>
    );
  }

  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const sideShort = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const scorers: Scorer[] = (scores.data ?? []).flatMap((r) => {
    const p = byId.get(r.player_id ?? 0);
    return p
      ? [{ player_id: p.id, name: p.name, position: p.position, points: r.points ?? 0 }]
      : [];
  });
  const best = teamOfTheWeek(scorers, settings.data?.formations ?? []);
  const star = best?.picks.reduce((top, p) => (p.points > top.points ? p : top), best.picks[0]!);

  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
  for (const p of best?.picks ?? []) counts[p.position] += 1;
  const laid = pitchRows(best?.picks ?? [], best?.formation ?? formationOf(counts));
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      laid[pos].map((p, i): PitchSlot =>
        p
          ? {
              key: `p${p.player_id}`,
              position: pos,
              name: shortName(p.name),
              tag: sideShort.get(byId.get(p.player_id)?.side_id ?? 0),
              sub: `${p.points} pts`,
              badge: p.player_id === star?.player_id ? '★' : undefined,
            }
          : { key: `${pos}${i}`, position: pos, name: null },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const label = gameweekLabel(gameweek, all);
  const fileName = `fhc-team-of-the-week-${gameweek.start_date}.png`;

  async function image(): Promise<Blob | null> {
    if (!card.current) return null;
    const node = card.current;
    // Export the card alone: drop the page's centring margins so the image
    // isn't shifted, and size it to the card.
    const url = await toPng(node, {
      pixelRatio: 3,
      cacheBust: true,
      width: node.offsetWidth,
      height: node.offsetHeight,
      style: { margin: '0' },
    });
    return (await fetch(url)).blob();
  }

  async function save() {
    setBusy(true);
    try {
      const blob = await image();
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setNotices([{ kind: 'error', text: 'Could not make the image. Try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const blob = await image();
      if (!blob) return;
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `FHC Team of the Week, ${label}` });
      } else {
        setNotices([
          { kind: 'info', text: 'Sharing isn’t available here. Use Save image instead.' },
        ]);
      }
    } catch {
      // Closing the share sheet counts as an error; nothing to report.
    } finally {
      setBusy(false);
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <>
      <div className="mb-3 mt-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="my-0">Team of the week</h1>
        <label className="text-sm font-semibold">
          <span className="sr-only">Gameweek</span>
          <select
            className="input-inline"
            value={gameweek.id}
            onChange={(e) => setParams({ gw: e.target.value })}
          >
            {[...locked].reverse().map((g) => (
              <option key={g.id} value={g.id}>
                {gameweekLabel(g, all)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Notices items={notices} />

      {scores.isLoading ? (
        <Loading />
      ) : !best ? (
        <p className="muted">No points recorded for {label} yet.</p>
      ) : (
        <>
          {/* The card is what gets saved as an image, so it carries everything. */}
          <div
            ref={card}
            className="mx-auto max-w-[26rem] overflow-hidden rounded-2xl bg-[#d91414] text-white shadow-card"
          >
            <div className="flex items-center gap-3 px-4 pb-3 pt-4">
              <img src="/crest.png" alt="" className="h-14 w-14 brightness-0 invert" />
              <div className="min-w-0 flex-1 font-display uppercase leading-none">
                <p className="text-xs font-bold tracking-widest text-white/80">
                  Felixstowe HC Fantasy
                </p>
                <p className="text-3xl font-extrabold">Team of the week</p>
                <p className="mt-1 text-sm font-bold text-white/90">
                  {label.split(' ')[0]} · w/e {formatShortDate(gameweek.start_date)}
                </p>
              </div>
              <div className="text-right font-display uppercase leading-none">
                <p className="display-num text-4xl">{best.total}</p>
                <p className="text-xs font-bold text-white/80">pts · {best.formation}</p>
              </div>
            </div>
            <Pitch rows={slots} stillBoards />
            {star && (
              <div className="flex items-center justify-between gap-2 bg-[#16181d] px-4 py-3 font-display uppercase">
                <span className="text-xs font-bold tracking-widest text-white/70">
                  ★ Player of the week
                </span>
                <span className="text-right text-lg font-extrabold">
                  {star.name}{' '}
                  <span className="text-[#ff6b6b]">
                    {sideShort.get(byId.get(star.player_id)?.side_id ?? 0)}
                  </span>{' '}
                  · {star.points} pts
                </span>
              </div>
            )}
          </div>

          <div className="mx-auto mt-4 flex max-w-[26rem] flex-wrap justify-center gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              {busy ? 'Making image' : 'Save image'}
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => void share()}
              >
                Share
              </button>
            )}
          </div>
          <p className="muted mx-auto mt-3 max-w-[26rem] text-center text-sm">
            The best possible 11 from every Felixstowe side this gameweek, in whichever allowed
            formation scores most.
          </p>
        </>
      )}
    </>
  );
}
