import { useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Sheet } from '@/components/Sheet';
import { ErrorText, Loading, Notices } from '@/components/ui';
import { ChipsCard } from '@/features/squad/ChipsCard';
import { useSquadEditor } from '@/features/squad/useSquadEditor';
import { PlayerDetail, PlayerSheet } from '@/features/player/PlayerDetail';
import { chipName } from '@/lib/chips';
import { PLAYER_DATA } from '@/lib/pickDisplay';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { BENCH, formatPrice, SQUAD_QUOTA, STARTERS, type SquadPlayer } from '@/lib/squad';
import { TeamPitch, type Badge } from './TeamPitch';
import { V3Market } from './V3Market';

/**
 * V3 Pick team and Transfers (approved boards), over the same squad logic as
 * V2 (useSquadEditor): only the look differs.
 */
export function V3Squad({ mode }: { mode: 'pick' | 'transfers' }) {
  const ed = useSquadEditor(mode);
  const [chipsOpen, setChipsOpen] = useState(false);
  if (ed.status === 'login') return <Navigate to="/login" replace />;
  if (ed.status === 'loading') return <Loading />;
  if (ed.status === 'error') return <ErrorText error={ed.error} />;
  if (ed.status === 'nogw') {
    return (
      <p className="v3-glass m-4 rounded-[20px] p-4 text-sm">
        There&apos;s no upcoming gameweek yet. A manager needs to sync or add fixtures.
      </p>
    );
  }
  const isPick = mode === 'pick';
  const {
    session,
    gameweek,
    all,
    sides,
    chips,
    s,
    bank,
    summary,
    wildcard,
    freeFix,
    problems,
    showProblems,
    dirty,
    saving,
    save,
    leave,
    go,
    transitionClick,
    setLoadedFrom,
    notices,
    setNotices,
    rows,
    bench,
    poolById,
    sideById,
    captainId,
    viceId,
    swapFrom,
    setSwapFrom,
    canSwap,
    swap,
    moveTo,
    setFocus,
    focused,
    focusedSlot,
    makeCaptain,
    makeVice,
    remove,
    replacementPositions,
    picker,
    setPicker,
    choices,
    add,
    sideCounts,
    nextFor,
    dataFor,
    dataMuted,
    dataKey,
    chooseData,
    dataOpen,
    setDataOpen,
    confirmOpen,
    setConfirmOpen,
    moves,
    squadPlayers,
    autoFill,
    points,
    statsFor,
    setStatsFor,
    lastPlayed,
    pickedShape,
    selected,
    goTransfers,
    empty,
    isKeeper,
    previousIds,
    names,
  } = ed;
  const side = (p: SquadPlayer) => sideById.get(p.side_id)?.short_name;
  const activeChip = chips.data?.find((c) => c.gameweek_id === gameweek.id);

  // ---------- Pick team: the 11 on their lines, the bench below ----------
  const pickRows = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      rows[pos].map((p, i): Badge =>
        p
          ? {
              key: `p${p.id}`,
              position: pos,
              name: names.get(p.id) ?? p.name,
              data: dataFor(p),
              tone: dataMuted(p) ? 'muted' : 'plain',
              side: side(p),
              mark: captainId === p.id ? 'C' : viceId === p.id ? 'V' : undefined,
              highlight: swapFrom !== null && canSwap(swapFrom, p.id),
              onClick: () => (swapFrom !== null ? swap(swapFrom, p.id) : setFocus(p.id)),
            }
          : {
              key: `${pos}${i}`,
              position: pos,
              name: 'Add',
              data: POSITION_NAMES[pos].slice(0, 3),
              tone: 'muted',
              empty: true,
              highlight:
                swapFrom !== null &&
                bench.includes(swapFrom) &&
                poolById.get(swapFrom)?.position === pos,
              onClick: () => {
                if (swapFrom === null || !moveTo(swapFrom, { position: pos })) goTransfers();
              },
            },
      ),
    ]),
  ) as Record<Position, Badge[]>;
  const benchBadges = bench.map((id, i): Badge => {
    const p = id === null ? null : poolById.get(id);
    const label = i === 0 ? 'Sub GK' : `Sub ${i}`;
    return p
      ? {
          key: `b${p.id}`,
          position: p.position,
          name: names.get(p.id) ?? p.name,
          data: dataFor(p),
          tone: dataMuted(p) ? 'muted' : 'plain',
          side: side(p),
          dim: !(swapFrom !== null && canSwap(swapFrom, p.id)),
          highlight: swapFrom !== null && canSwap(swapFrom, p.id),
          onClick: () => (swapFrom !== null ? swap(swapFrom, p.id) : setFocus(p.id)),
        }
      : {
          key: `be${i}`,
          position: i === 0 ? 'GK' : 'MID',
          name: label,
          data: '+',
          tone: 'muted',
          empty: true,
          highlight:
            swapFrom !== null && selected.has(swapFrom) && (i === 0) === isKeeper(swapFrom),
          onClick: () => {
            if (swapFrom === null || !moveTo(swapFrom, { bench: i })) goTransfers();
          },
        };
  });

  // ---------- Transfers: all 15 on their lines, prices showing ----------
  let room = STARTERS + BENCH - squadPlayers.length;
  const transferRows = Object.fromEntries(
    POSITIONS.map((pos) => {
      const here = squadPlayers.filter((p) => p.position === pos);
      const gaps = Math.max(0, Math.min(room, SQUAD_QUOTA[pos] - here.length));
      room -= gaps;
      return [
        pos,
        [
          ...here.map((p): Badge => ({
            key: `t${p.id}`,
            position: pos,
            name: names.get(p.id) ?? p.name,
            data: `${formatPrice(p.price)}m`,
            side: side(p),
            highlight: previousIds.length > 0 && !previousIds.includes(p.id),
            onClick: () => setFocus(p.id),
          })),
          ...Array.from({ length: gaps }, (_, i): Badge => ({
            key: `t-${pos}${i}`,
            position: pos,
            name: 'Add',
            data: pos,
            tone: 'muted',
            empty: true,
            onClick: () => setPicker({ positions: [pos] }),
          })),
        ],
      ];
    }),
  ) as Record<Position, Badge[]>;
  const unlimited = wildcard || freeFix || summary.transfers === null;
  const left = unlimited ? null : Math.max(0, s.transfers_per_gameweek - (summary.transfers ?? 0));
  const firstGap = POSITIONS.find(
    (pos) => squadPlayers.filter((p) => p.position === pos).length < SQUAD_QUOTA[pos],
  );
  const lastMove = moves.at(-1);

  const back = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    setLoadedFrom(null);
    go('/', 'back');
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[26rem] flex-col pb-[env(safe-area-inset-bottom)]">
      {/* Title bar: back, the Pick / Transfers switch, the shape */}
      <header className="vt-squad-head flex items-center justify-between px-3.5 pb-2.5 pt-1">
        <button type="button" onClick={back} className="v3-icon text-lg" aria-label="Back">
          ‹
        </button>
        <nav
          className="flex rounded-[14px] border border-white/10 bg-white/[0.06] p-[3px]"
          aria-label="Squad pages"
        >
          {(
            [
              ['/squad', 'Pick', 'pick'],
              ['/transfers', 'Transfers', 'transfers'],
            ] as const
          ).map(([to, label, m]) => (
            <Link
              key={to}
              to={to}
              aria-current={mode === m ? 'page' : undefined}
              onClick={
                mode === m ? (e) => e.preventDefault() : transitionClick(to, 'swap', leave(to))
              }
              className={`v3-disp flex min-h-[38px] items-center rounded-[11px] px-4 text-[14px] no-underline hover:no-underline ${mode === m ? 'bg-white text-[#05070c]' : 'text-[rgb(var(--v3-mut))]'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {isPick ? (
          <span className="v3-icon v3-disp text-[14px]">
            {selected.size === STARTERS ? pickedShape : '-'}
          </span>
        ) : (
          <span className="w-10" />
        )}
      </header>

      <div className="px-3.5">
        <Notices items={notices} />
      </div>

      {isPick && empty ? (
        <section className="v3-glass mx-3.5 rounded-[22px] p-5 text-center">
          <p className="v3-disp text-[26px]">No squad yet</p>
          <p className="mt-1 text-sm text-[rgb(var(--v3-mut))]">Pick your 15 on Transfers first.</p>
          <Link to="/transfers" className="v3-btn v3-red v3-glow mt-4 text-white no-underline">
            Go to transfers
          </Link>
        </section>
      ) : isPick ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto px-3.5 pb-2.5 [scrollbar-width:none]">
            <Pill on={Boolean(activeChip)} onClick={() => setChipsOpen(true)}>
              {activeChip ? `${chipName(activeChip.chip)} ✓` : 'Chips'}
            </Pill>
            <Pill onClick={() => setDataOpen(true)}>
              {PLAYER_DATA.find((o) => o.key === dataKey)?.label} ▾
            </Pill>
          </div>
          {swapFrom !== null && (
            <div className="mx-3.5 mb-2 flex items-center justify-between rounded-xl bg-[#16181d] px-3 py-1.5 text-[13px] font-semibold">
              <span>Tap who {poolById.get(swapFrom)?.name} swaps with</span>
              <button
                type="button"
                onClick={() => setSwapFrom(null)}
                className="min-h-[44px] px-2 font-bold text-[#ffd400]"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="vt-squad-pitch px-3">
            <TeamPitch rows={pickRows} bench={benchBadges} height={372} card />
          </div>
          <div className="h-[104px]" />
        </>
      ) : (
        <>
          <section className="v3-glass mx-3.5 grid grid-cols-3 rounded-[20px] px-3.5 py-3 text-center">
            <Stat
              value={unlimited ? '∞' : `${left}/${s.transfers_per_gameweek}`}
              label={unlimited ? 'Transfers' : 'Free left'}
            />
            <Stat value={`${summary.count}`} label={`Squad of ${STARTERS + BENCH}`} />
            <Stat
              value={`${formatPrice(bank)}m`}
              label="Bank"
              tone={
                bank < 0
                  ? 'text-[rgb(var(--v3-red))]'
                  : 'text-[rgb(var(--v3-mint))] [text-shadow:0_0_18px_rgb(63_242_168/.5)]'
              }
            />
          </section>
          {lastMove && (lastMove[0] || lastMove[1]) && (
            <section className="v3-glass v3-in mx-3.5 mt-2.5 flex items-center gap-2.5 rounded-[20px] px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="v3-cap">Out</span>
                <span className="block truncate text-[15px] font-bold line-through decoration-[rgb(var(--v3-red))]">
                  {lastMove[0]?.name ?? '-'}
                </span>
              </span>
              <span className="text-lg text-[rgb(var(--v3-mint))]">→</span>
              <span className="min-w-0 flex-1 text-right">
                <span className="v3-cap">In</span>
                <span className="block truncate text-[15px] font-bold text-[rgb(var(--v3-mint))]">
                  {lastMove[1]?.name ?? '-'}
                </span>
              </span>
            </section>
          )}
          {freeFix && (
            <p className="mx-3.5 mt-2.5 rounded-xl border border-[#2c4f73] bg-[#14263a] px-3 py-1.5 text-xs font-semibold text-[#cfe3f7]">
              Squads are now 2 GK, 5 DEF, 5 MID and 3 FWD. Changes to get yours there are free.
            </p>
          )}
          <div className="vt-squad-pitch relative mt-2.5 px-3">
            <TeamPitch rows={transferRows} height={392} card />
            {squadPlayers.length < STARTERS + BENCH && (
              <button
                type="button"
                onClick={autoFill}
                className="absolute left-5 top-1 min-h-[36px] rounded-full bg-white px-3 text-xs font-extrabold text-[#05070c]"
              >
                Auto pick
              </button>
            )}
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setSwapFrom(null);
                  setLoadedFrom(null);
                  setNotices([]);
                }}
                className="absolute right-5 top-1 min-h-[36px] rounded-full border border-white/15 bg-black/50 px-3 text-xs font-extrabold"
              >
                Reset
              </button>
            )}
          </div>
          <div className="h-[84px]" />
        </>
      )}

      {/* Bottom actions, pinned */}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[26rem] bg-gradient-to-t from-[rgb(var(--v3-bg))] via-[rgb(var(--v3-bg)/.95)] to-transparent px-3.5 pb-[max(10px,env(safe-area-inset-bottom))] pt-6">
        {isPick ? (
          !empty &&
          dirty && (
            <div className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1 text-xs leading-snug text-[rgb(var(--v3-mut))]">
                {showProblems ? (
                  <span className="text-[rgb(var(--v3-amber))]">⚠ {problems[0]}</span>
                ) : (
                  <>
                    Captain{' '}
                    {poolById
                      .get(captainId ?? 0)
                      ?.name.split(' ')
                      .at(-1) ?? '-'}{' '}
                    · vice{' '}
                    {poolById
                      .get(viceId ?? 0)
                      ?.name.split(' ')
                      .at(-1) ?? '-'}
                  </>
                )}
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="v3-btn v3-red v3-glow px-7 text-white disabled:opacity-60"
              >
                {saving ? 'Saving' : 'Save'}
              </button>
            </div>
          )
        ) : (
          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={!firstGap}
              onClick={() => firstGap && setPicker({ positions: [firstGap] })}
              className="v3-btn v3-glass flex-1 text-white disabled:opacity-40"
            >
              Add player
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setConfirmOpen(true)}
              className="v3-btn v3-red v3-glow flex-1 text-white disabled:opacity-40 disabled:shadow-none"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* ---------- Sheets ---------- */}
      {chipsOpen && (
        <Sheet title="Chips" onClose={() => setChipsOpen(false)}>
          <p className="mb-3 text-sm text-[rgb(var(--v3-mut))]">
            One per gameweek. Each once a season.
          </p>
          <ChipsCard
            userId={session.user.id}
            gameweek={gameweek}
            gameweeks={all}
            sides={sides.data ?? []}
            onNotice={setNotices}
            elsewhere={{ wildcard: 'Transfers' }}
          />
        </Sheet>
      )}

      {dataOpen && (
        <Sheet title="Player data" onClose={() => setDataOpen(false)}>
          <div role="radiogroup" aria-label="Player data">
            {PLAYER_DATA.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={dataKey === o.key}
                onClick={() => chooseData(o.key)}
                className="flex min-h-[52px] w-full items-center border-b border-white/10 text-left"
              >
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] font-bold">{o.label}</span>
                  <span className="text-xs text-[rgb(var(--v3-mut))]">{o.help}</span>
                </span>
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white">
                  {dataKey === o.key && (
                    <span className="h-[11px] w-[11px] rounded-full bg-white" />
                  )}
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {confirmOpen && (
        <Sheet title="Confirm transfers" onClose={() => setConfirmOpen(false)}>
          {moves.length ? (
            moves.map(([out, inn], i) => (
              <div
                key={i}
                className="v3-glass mb-2 flex items-center gap-2.5 rounded-[18px] px-3.5 py-3"
              >
                <MoveSide
                  label="Out"
                  tone="text-[#ff8a97]"
                  p={out}
                  sideName={out ? sideById.get(out.side_id)?.short_name : undefined}
                />
                <span className="text-lg text-[rgb(var(--v3-mint))]">→</span>
                <MoveSide
                  label="In"
                  tone="text-[rgb(var(--v3-mint))]"
                  p={inn}
                  sideName={inn ? sideById.get(inn.side_id)?.short_name : undefined}
                  right
                />
              </div>
            ))
          ) : (
            <p className="text-sm">
              {previousIds.length
                ? 'No transfers: just your line-up has changed.'
                : `Your first squad: ${squadPlayers.length} players.`}
            </p>
          )}
          <dl className="my-3.5 space-y-2 text-sm">
            <Row
              label="Transfers this gameweek"
              value={
                unlimited
                  ? wildcard
                    ? 'Unlimited (wildcard)'
                    : 'Unlimited'
                  : `${summary.transfers ?? 0} of ${s.transfers_per_gameweek}`
              }
            />
            <Row label="Bank after" value={`${formatPrice(bank)}m`} />
            <Row label="Then" value="On to Pick team" />
          </dl>
          {problems.length > 0 && (
            <ul className="mb-3 list-disc space-y-1 rounded-xl border border-[#7a5a24] bg-[#2b2113] py-2 pl-7 pr-3 text-sm font-semibold text-[#f5d9a8]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={saving || problems.length > 0}
            onClick={() => {
              setConfirmOpen(false);
              void save();
            }}
            className="v3-btn v3-red v3-glow w-full text-white disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? 'Saving' : problems.length ? 'Fix the above first' : 'Confirm transfers'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="mt-1 min-h-[44px] w-full text-sm font-bold text-[rgb(var(--v3-mut))]"
          >
            Back to transfers
          </button>
        </Sheet>
      )}

      {picker && (
        <V3Market
          title={
            picker.positions.length > 1
              ? 'Choose a replacement'
              : picker.slot === undefined
                ? `Add a ${POSITION_NAMES[picker.positions[0]!].toLowerCase()}`
                : picker.slot === 0
                  ? 'Add a sub keeper'
                  : `Add sub ${picker.slot}`
          }
          candidates={choices}
          bank={bank}
          sides={sides.data ?? []}
          sideCounts={sideCounts}
          maxPerSide={s.max_per_side}
          nextFor={nextFor}
          points={(id) => points.data?.get(id) ?? 0}
          onPick={(id) => {
            add(id, picker.slot);
            setPicker(null);
          }}
          onStats={setStatsFor}
          onClose={() => setPicker(null)}
        />
      )}

      {focused && (
        <Sheet
          title={
            focusedSlot < 0
              ? focused.name
              : `${focused.name} (${focusedSlot === 0 ? 'sub keeper' : `sub ${focusedSlot}`})`
          }
          onClose={() => setFocus(null)}
        >
          <PlayerDetail
            playerId={focused.id}
            gameweekId={lastPlayed?.id}
            actions={
              mode === 'transfers' ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="v3-btn v3-red w-full text-white"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                      setPicker(
                        focusedSlot < 0
                          ? { positions: replacementPositions(focused) }
                          : {
                              positions: focusedSlot === 0 ? ['GK'] : replacementPositions(focused),
                              slot: focusedSlot,
                            },
                      );
                    }}
                  >
                    Transfer out
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] w-full text-sm font-semibold text-[#ff8a97]"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                    }}
                  >
                    Remove (leave the place empty)
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {focusedSlot < 0 && (
                    <>
                      <button
                        type="button"
                        className="v3-btn v3-red text-white disabled:opacity-50"
                        disabled={captainId === focused.id}
                        onClick={() => {
                          makeCaptain(focused.id);
                          setFocus(null);
                        }}
                      >
                        {captainId === focused.id ? 'Captain' : 'Make captain'}
                      </button>
                      <button
                        type="button"
                        className="v3-btn v3-glass text-white disabled:opacity-50"
                        disabled={viceId === focused.id}
                        onClick={() => {
                          makeVice(focused.id);
                          setFocus(null);
                        }}
                      >
                        {viceId === focused.id ? 'Vice' : 'Make vice'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="v3-btn v3-glass text-white"
                    onClick={() => {
                      setSwapFrom(focused.id);
                      setFocus(null);
                    }}
                  >
                    {focusedSlot < 0 ? 'Swap with sub' : 'Bring on'}
                  </button>
                  <Link
                    to="/transfers"
                    onClick={transitionClick('/transfers', 'swap', leave('/transfers'))}
                    className="v3-btn v3-glass text-white no-underline hover:no-underline"
                  >
                    Transfer
                  </Link>
                </div>
              )
            }
          />
        </Sheet>
      )}

      {statsFor && (
        <PlayerSheet
          playerId={statsFor}
          gameweekId={lastPlayed?.id}
          onClose={() => setStatsFor(null)}
        />
      )}
    </div>
  );
}

function Pill({
  children,
  on,
  onClick,
}: {
  children: ReactNode;
  on?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[38px] shrink-0 items-center rounded-full border px-3.5 text-xs font-bold ${on ? 'border-[rgb(255_51_71/.45)] bg-[rgb(255_51_71/.14)] text-[#ffb3bb]' : 'border-white/10 bg-white/[0.05]'}`}
    >
      {children}
    </button>
  );
}

function Stat({ value, label, tone = '' }: { value: string; label: string; tone?: string }) {
  return (
    <span>
      <span className={`v3-disp v3-num block text-[32px] ${tone}`}>{value}</span>
      <span className="v3-cap">{label}</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[rgb(var(--v3-mut))]">{label}</dt>
      <dd className="v3-num m-0">{value}</dd>
    </div>
  );
}

function MoveSide({
  label,
  tone,
  p,
  sideName,
  right = false,
}: {
  label: string;
  tone: string;
  p: { name: string; position: Position; price: number } | null;
  sideName?: string;
  right?: boolean;
}) {
  return (
    <span className={`min-w-0 flex-1 ${right ? 'text-right' : ''}`}>
      <span className={`v3-cap ${tone}`}>{label}</span>
      <span className="block truncate text-[14px] font-bold">{p?.name ?? '-'}</span>
      {p && (
        <span className="block truncate text-[11px] text-[rgb(var(--v3-mut))]">
          {p.position} · {sideName} · {formatPrice(p.price)}m
        </span>
      )}
    </span>
  );
}
