import { Link } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { cupDraw, type CupRound, type CupTie } from '@/lib/cup';
import { formatWeekdayTime, gameweekLabel } from '@/lib/format';
import {
  useCupDraw,
  useGameweeks,
  useLeaguePoints,
  useSettings,
  type CupSeed,
} from '@/lib/queries';

/** Settled: two days after a gameweek starts its scores are final (as auto-subs). */
const settled = (startDate: string, now = new Date()) =>
  new Date(`${startDate}T00:00:00Z`).getTime() + 2 * 86_400_000 <= now.getTime();

/**
 * The FHC Cup: everyone with a team by its first deadline, seeded by the
 * league table then, one gameweek a round; the higher score after transfer
 * hits goes through, a tie to the higher seed.
 */
export function CupView() {
  const { session } = useAuth();
  const points = useLeaguePoints();
  const gameweeks = useGameweeks();
  const settings = useSettings();
  const all = [...(gameweeks.data ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const startNumber = settings.data?.cup_start ?? 9;
  const start = all[startNumber - 1];
  const now = new Date();
  const started = Boolean(start && new Date(start.deadline) <= now);
  // Entrants and seeds are frozen at the first deadline (0035), so later
  // sign-ups or deleted accounts don't rewrite rounds already played.
  const draw = useCupDraw(started);

  if (points.isLoading || gameweeks.isLoading || draw.isLoading) return <Loading />;
  if (points.error) return <ErrorText error={points.error} />;
  if (draw.error) return <ErrorText error={draw.error} />;

  const rules = (
    <p className="muted px-1 text-sm leading-relaxed">
      Everyone with a team by the GW{startNumber} deadline is in, seeded by the league table at that
      point (top seeds get any byes). Each round is one gameweek: the higher score after transfer
      hits goes through, and a tie goes to the higher seed.
    </p>
  );
  if (!start || !started) {
    return (
      <>
        <div className="card text-center">
          <h2 className="mb-1">The FHC Cup</h2>
          <p className="mb-0">
            Starts in GW{startNumber}
            {start ? `, deadline ${formatWeekdayTime(start.deadline)}` : ''}.
          </p>
        </div>
        {rules}
      </>
    );
  }

  const label = (id: number | undefined) => {
    const g = all.find((x) => x.id === id);
    return g ? gameweekLabel(g, all).split(' ')[0] : 'TBC';
  };
  const seeds: CupSeed[] = draw.data ?? [];
  const gwOf = (id: number | undefined) => all.find((g) => g.id === id);
  const rounds: CupRound[] = cupDraw(
    seeds.length,
    all.slice(startNumber - 1).map((g) => g.id),
    (seed, gw) => {
      const id = seeds[seed - 1]?.user_id;
      return id ? points.data?.get(id)?.get(gw) : undefined;
    },
    (gw) => {
      const g = gwOf(gw);
      return Boolean(g && new Date(g.deadline) <= now && settled(g.start_date, now));
    },
  );
  if (!rounds.length) return <p className="muted">Not enough teams for a cup.</p>;

  const locked = (r: CupRound) => {
    const g = gwOf(r.gameweekId);
    return Boolean(g && new Date(g.deadline) <= now);
  };
  const current = Math.max(0, rounds.map(locked).lastIndexOf(true));
  const round = rounds[current]!;
  const live = locked(round) && !settled(gwOf(round.gameweekId)!.start_date, now);
  const mySeed = seeds.findIndex((s) => s.user_id === session?.user.id) + 1;
  const name = (seed: number | null | undefined) =>
    seed === null ? 'Bye' : seed === undefined ? 'To be decided' : seeds[seed - 1]!.team_name;
  const champion = rounds.at(-1)!.ties[0]?.winner;

  // Where you stand: your tie now, or the round you went out in.
  let mine: { tie: CupTie; round: CupRound } | null = null;
  let out: { round: CupRound; to: number } | null = null;
  if (mySeed) {
    for (const r of rounds.slice(0, current + 1)) {
      const t = r.ties.find((x) => x.a === mySeed || x.b === mySeed);
      if (!t) break;
      mine = { tie: t, round: r };
      if (t.winner !== undefined && t.winner !== mySeed) {
        out = { round: r, to: t.winner };
        break;
      }
    }
  }

  return (
    <>
      {champion !== undefined && (
        <div className="hero !mb-3 text-center">
          <p className="m-0 font-display text-sm font-bold uppercase text-white/85">
            FHC Cup winners
          </p>
          <p className="m-0 font-display text-3xl font-extrabold uppercase">{name(champion)}</p>
        </div>
      )}

      {mine && !out && champion === undefined && (
        <div className="hero !mb-3">
          <div className="flex items-center justify-between font-display text-xs font-bold uppercase">
            <span>FHC Cup · {mine.round.name}</span>
            <span className="flex items-center gap-1.5">
              {live && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7dff9e]" />}
              {label(mine.round.gameweekId)}
              {live ? ' · Live' : ''}
            </span>
          </div>
          {mine.tie.a === null || mine.tie.b === null ? (
            <p className="mb-0 mt-3 text-center">You have a bye this round: straight through.</p>
          ) : (
            <>
              <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <TeamCell seed={mine.tie.a} seeds={seeds} you={mySeed} />
                <span className="display-num whitespace-nowrap text-[2.4rem] leading-none">
                  {mine.tie.aPoints ?? '-'} <span className="text-white/60">-</span>{' '}
                  {mine.tie.bPoints ?? '-'}
                </span>
                <TeamCell seed={mine.tie.b} seeds={seeds} you={mySeed} right />
              </div>
              <p className="mb-0 mt-2.5 text-center text-sm text-white/90">
                {mine.tie.winner === mySeed
                  ? 'Through to the next round.'
                  : 'The higher score this gameweek goes through.'}
              </p>
            </>
          )}
        </div>
      )}
      {out && (
        <p className="card text-center">
          You went out in the {out.round.name.toLowerCase()} to {name(out.to)}.
        </p>
      )}
      {!mySeed && session && (
        <p className="card muted text-center">You weren&apos;t in this season&apos;s Cup.</p>
      )}

      <div className="card !px-3 !pt-2">
        <h2 className="mb-1 font-display text-sm font-bold uppercase text-ink-soft">
          {round.name} · {label(round.gameweekId)}
        </h2>
        <Ties ties={round.ties} name={name} seeds={seeds} />
        {current > 0 && (
          <details className="border-t border-line">
            <summary className="flex min-h-tap cursor-pointer items-center text-sm font-bold text-ink-soft">
              Earlier rounds
            </summary>
            {rounds
              .slice(0, current)
              .reverse()
              .map((r) => (
                <div key={r.name} className="pb-2">
                  <h3 className="mb-0 mt-2 font-display text-xs font-bold uppercase text-ink-soft">
                    {r.name} · {label(r.gameweekId)}
                  </h3>
                  <Ties ties={r.ties} name={name} seeds={seeds} />
                </div>
              ))}
          </details>
        )}
      </div>
      {rules}
    </>
  );
}

function TeamCell({
  seed,
  seeds,
  you,
  right = false,
}: {
  seed: number | null | undefined;
  seeds: CupSeed[];
  you: number;
  right?: boolean;
}) {
  const s = typeof seed === 'number' ? seeds[seed - 1] : undefined;
  return (
    <Link
      to={s?.user_id ? `/teams/${s.user_id}` : '#'}
      className={`flex min-w-0 flex-col text-white no-underline hover:no-underline ${right ? 'items-end text-right' : ''}`}
    >
      <span className="max-w-full truncate font-extrabold">{s?.team_name ?? 'To be decided'}</span>
      <span className="text-xs text-white/90">{seed === you ? 'You' : s?.display_name}</span>
    </Link>
  );
}

function Ties({
  ties,
  name,
  seeds,
}: {
  ties: CupTie[];
  name: (seed: number | null | undefined) => string;
  seeds: CupSeed[];
}) {
  // Byes aren't games: list the ties that are.
  const games = ties.filter((t) => t.a !== null || t.b !== null);
  return (
    <ul>
      {games.map((t, i) => (
        <li
          key={i}
          className="grid min-h-[52px] grid-cols-[1fr_4.5rem_1fr] items-center gap-1 border-t border-line text-sm"
        >
          <TieName
            seed={t.a}
            won={t.winner !== undefined && t.winner === t.a}
            name={name}
            seeds={seeds}
          />
          <span className="display-num text-center text-lg">
            {t.a === null || t.b === null
              ? 'Bye'
              : t.aPoints === undefined && t.bPoints === undefined
                ? 'v'
                : `${t.aPoints ?? 0} - ${t.bPoints ?? 0}`}
          </span>
          <TieName
            seed={t.b}
            won={t.winner !== undefined && t.winner === t.b}
            name={name}
            seeds={seeds}
            right
          />
        </li>
      ))}
    </ul>
  );
}

function TieName({
  seed,
  won,
  name,
  seeds,
  right = false,
}: {
  seed: number | null | undefined;
  won: boolean;
  name: (seed: number | null | undefined) => string;
  seeds: CupSeed[];
  right?: boolean;
}) {
  const cls = `truncate ${won ? 'font-extrabold' : ''} ${right ? 'text-right' : ''}`;
  const userId = typeof seed === 'number' ? seeds[seed - 1]?.user_id : null;
  return userId ? (
    <Link to={`/teams/${userId}`} className={`${cls} text-ink no-underline`}>
      {name(seed)}
    </Link>
  ) : (
    <span className={`${cls} muted`}>{seed === null ? '' : name(seed)}</span>
  );
}
