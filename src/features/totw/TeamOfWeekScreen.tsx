import { toPng } from 'html-to-image';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { useSearchParams } from 'react-router-dom';
import { Pitch, type PitchSlot } from '@/components/Pitch';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formationOf, pitchRows } from '@/lib/formation';
import { formatShortDate, gameweekLabel, shortName } from '@/lib/format';
import {
  lockedGameweeks,
  useGameweeks,
  useGameweekScores,
  useGameweekSides,
  useScoredGameweeks,
  usePlayers,
  useSettings,
  useSides,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { teamOfTheWeek, type Scorer } from '@/lib/teamOfWeek';
import { PlayerSheet } from '@/features/player/PlayerDetail';

/** Facebook's best portrait size: 1080 x 1350 (4:5), drawn at 540 x 675 and doubled. */
const SOCIAL = { width: 540, height: 675 };

/** The social card as a PNG. */
async function renderCard(node: HTMLElement): Promise<Blob> {
  const url = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    width: SOCIAL.width,
    height: SOCIAL.height,
  });
  return (await fetch(url)).blob();
}

/** Can this browser hand an image file to the phone's share sheet? */
function canShareFiles(): boolean {
  try {
    return Boolean(
      navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }),
    );
  } catch {
    return false;
  }
}

export function TeamOfWeekScreen() {
  const [params, setParams] = useSearchParams();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const settings = useSettings();
  const card = useRef<HTMLDivElement>(null);
  // The picture is made from its own 4:5 card, kept off screen.
  const social = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const scored = useScoredGameweeks();
  const all = gameweeks.data ?? [];
  // Only gameweeks that have been played; the newest by default.
  const locked = lockedGameweeks(all).filter((g) => scored.data?.has(g.id));
  const wanted = Number(params.get('gw'));
  const gameweek = locked.find((g) => g.id === wanted) ?? locked.at(-1);
  const scores = useGameweekScores(gameweek?.id);
  const played = useGameweekSides(gameweek?.id);
  // The image is made ahead of the tap: iPhones only open the share sheet if
  // it's asked for straight after the tap, not after seconds of drawing.
  const prepKey = `${gameweek?.id ?? 0}-${scores.dataUpdatedAt}`;
  const [prepared, setPrepared] = useState<{ key: string; blob: Blob } | null>(null);
  // If the share sheet won't open: the picture on screen to press and hold.
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    if (!scores.data) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (!social.current) return;
      renderCard(social.current)
        .then((blob) => !cancelled && setPrepared({ key: prepKey, blob }))
        .catch(() => undefined);
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [prepKey, scores.data]);

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
  // The side they played for that week ("M2/M1" for two games), else their usual one.
  const sideFor = (playerId: number) =>
    (played.data?.get(playerId) ?? [byId.get(playerId)?.side_id ?? 0])
      .map((id) => sideShort.get(id))
      .join('/');
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
              tag: sideFor(p.player_id),
              sub: `${p.points} pts`,
              badge: p.player_id === star?.player_id ? '★' : undefined,
              onClick: () => setOpen(p.player_id),
            }
          : { key: `${pos}${i}`, position: pos, name: null },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const label = gameweekLabel(gameweek, all);
  const fileName = `fhc-team-of-the-week-${gameweek.start_date}.png`;

  const shareable = canShareFiles();

  async function saveOrShare() {
    if (!social.current) return;
    setBusy(true);
    try {
      const blob = prepared?.key === prepKey ? prepared.blob : await renderCard(social.current);
      const file = new File([blob], fileName, { type: 'image/png' });
      if (shareable) {
        try {
          // The phone's share sheet: Save Image / Save to Photos, WhatsApp, Instagram...
          await navigator.share({ files: [file], title: `FHC Team of the Week, ${label}` });
        } catch (e) {
          // Closing the sheet is fine; anything else, show the picture to save by hand.
          if ((e as Error).name !== 'AbortError') setFallback(URL.createObjectURL(file));
        }
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch {
      setNotices([{ kind: 'error', text: 'Could not make the image. Try again.' }]);
    } finally {
      setBusy(false);
    }
  }

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
            <Pitch rows={slots} />
            {star && (
              <div className="flex items-center justify-between gap-2 bg-[#16181d] px-4 py-3 font-display uppercase">
                <span className="text-xs font-bold tracking-widest text-white/70">
                  ★ Player of the week
                </span>
                <span className="text-right text-lg font-extrabold">
                  {star.name} <span className="text-[#ff6b6b]">{sideFor(star.player_id)}</span> ·{' '}
                  {star.points} pts
                </span>
              </div>
            )}
          </div>

          {/* The image for socials: 4:5, no shadows (they ghost on iPhones). Off screen. */}
          <div aria-hidden="true" className="pointer-events-none fixed left-[-10000px] top-0">
            <div
              ref={social}
              className="no-shadow flex flex-col overflow-hidden bg-[#d91414] text-white"
              style={SOCIAL}
            >
              <div className="flex items-center gap-3 px-5 py-3">
                <img src="/crest.png" alt="" className="h-14 w-14 brightness-0 invert" />
                <div className="min-w-0 flex-1 font-display uppercase leading-none">
                  <p className="text-xs font-bold tracking-widest text-white/80">
                    Felixstowe HC Fantasy
                  </p>
                  <p className="text-[2.1rem] font-extrabold">Team of the week</p>
                  <p className="mt-1 text-sm font-bold text-white/90">
                    {label.split(' ')[0]} · w/e {formatShortDate(gameweek.start_date)}
                  </p>
                </div>
                <div className="text-right font-display uppercase leading-none">
                  <p className="display-num text-5xl">{best.total}</p>
                  <p className="text-xs font-bold text-white/80">pts · {best.formation}</p>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <Pitch rows={slots} fit />
              </div>
              {star && (
                <div className="flex items-center justify-between gap-2 bg-[#16181d] px-5 py-3 font-display uppercase">
                  <span className="text-xs font-bold tracking-widest text-white/70">
                    ★ Player of the week
                  </span>
                  <span className="text-right text-xl font-extrabold">
                    {star.name} <span className="text-[#ff6b6b]">{sideFor(star.player_id)}</span> ·{' '}
                    {star.points} pts
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto mt-4 flex max-w-[26rem] flex-wrap justify-center gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void saveOrShare()}
            >
              {busy ? 'Making image' : shareable ? 'Save or share image' : 'Download image'}
            </button>
          </div>
          {shareable && (
            <p className="muted mx-auto mt-2 max-w-[26rem] text-center text-xs">
              Then tap Save Image (iPhone) or Save to Photos (Android) to put it in your camera
              roll, or pick WhatsApp, Instagram and so on.
            </p>
          )}
          {fallback && (
            <Sheet
              title="Save the picture"
              onClose={() => {
                URL.revokeObjectURL(fallback);
                setFallback(null);
              }}
            >
              <p className="mb-3 text-sm">
                Press and hold the picture, then tap Save to Photos (or Save image).
              </p>
              <img
                src={fallback}
                alt={`FHC Team of the Week, ${label}`}
                className="w-full rounded-xl"
              />
            </Sheet>
          )}
          {open && (
            <PlayerSheet playerId={open} gameweekId={gameweek.id} onClose={() => setOpen(null)} />
          )}
          <p className="muted mx-auto mt-3 max-w-[26rem] text-center text-sm">
            The best possible 11 from every Felixstowe side this gameweek, in whichever allowed
            formation scores most.
          </p>
        </>
      )}
    </>
  );
}
