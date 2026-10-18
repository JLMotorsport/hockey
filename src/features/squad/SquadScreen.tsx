import { Link, Navigate } from 'react-router-dom';
import { ErrorText, Loading, Notices } from '@/components/ui';
import { formatDeadline } from '@/lib/format';
import { PLAYER_DATA } from '@/lib/pickDisplay';
import { ChipsCard } from './ChipsCard';
import { PlayerPicker } from './PlayerPicker';
import { StatsTable } from '@/components/StatsTable';
import { VersionSwitch } from '@/components/VersionSwitch';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { Pitch } from '@/components/Pitch';
import { PhoneTabBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { PlayerDetail, PlayerSheet } from '@/features/player/PlayerDetail';
import { BENCH, formatPrice, SQUAD_QUOTA, STARTERS, type SquadPlayer } from '@/lib/squad';

import { useSquadEditor, type MovePlayer } from './useSquadEditor';

/**
 * Two pages over the same squad, as in FPL. Pick team: the starting 11, subs,
 * captain and vice, and the team chips. Transfers: who is in the 15, the
 * bank and the wildcard.
 */
export function SquadScreen({ mode = 'pick' }: { mode?: 'pick' | 'transfers' }) {
  const ed = useSquadEditor(mode);
  if (ed.status === 'login') return <Navigate to="/login" replace />;
  if (ed.status === 'loading') return <Loading />;
  if (ed.status === 'error') return <ErrorText error={ed.error} />;
  if (ed.status === 'nogw') {
    return (
      <>
        <h1>Pick your squad</h1>
        <p className="muted">
          There&apos;s no upcoming gameweek yet. A manager needs to sync or add fixtures.
        </p>
      </>
    );
  }
  const {
    session,
    transitionClick,
    sides,
    all,
    gameweek,
    lastPlayed,
    dataKey,
    dataOpen,
    setDataOpen,
    confirmOpen,
    setConfirmOpen,
    chooseData,
    wildcard,
    captainId,
    viceId,
    setLoadedFrom,
    notices,
    setNotices,
    saving,
    view,
    setView,
    statColumns,
    statPoints,
    problemsOpen,
    setProblemsOpen,
    picker,
    setPicker,
    setSwapFrom,
    setFocus,
    statsFor,
    setStatsFor,
    sideById,
    previousIds,
    s,
    picked,
    benchPlayers,
    freeFix,
    transfers,
    firstSquad,
    summary,
    problems,
    nextFor,
    benchSlot,
    add,
    replacementPositions,
    remove,
    makeCaptain,
    makeVice,
    save,
    squadPlayers,
    bank,
    slots,
    benchSlots,
    focused,
    focusedSlot,
    swapping,
    choices,
    sideCounts,
    autoFill,
    transferRows,
    moves,
    dirty,
    leave,
    empty,
    showProblems,
  } = ed;
  const overlays = (
    <>
      {picker && (
        <PlayerPicker
          title={
            picker.positions.length > 1
              ? 'Choose a replacement'
              : picker.slot === undefined
                ? `Add a ${POSITION_NAMES[picker.positions[0]!].toLowerCase()}`
                : picker.slot === 0
                  ? 'Add a sub goalkeeper'
                  : `Add sub ${picker.slot}`
          }
          candidates={choices}
          bank={bank}
          sides={sides.data ?? []}
          sideCounts={sideCounts}
          maxPerSide={s.max_per_side}
          showPosition={picker.positions.length > 1}
          nextFor={nextFor}
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
                    className="btn w-full"
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
                    className="min-h-tap w-full text-sm font-semibold text-brand underline"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                    }}
                  >
                    Remove (leave the slot empty)
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {focusedSlot < 0 && (
                    <>
                      <button
                        type="button"
                        className="btn"
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
                        className="btn btn-quiet"
                        disabled={viceId === focused.id}
                        onClick={() => {
                          makeVice(focused.id);
                          setFocus(null);
                        }}
                      >
                        {viceId === focused.id ? 'Vice-captain' : 'Make vice'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`btn ${focusedSlot < 0 ? 'btn-quiet' : ''}`}
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
                    className="btn btn-quiet no-underline hover:no-underline"
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
    </>
  );

  const subsTone = 'text-[#1f7a4d] dark:text-[#7fd6a2]';
  const isPick = mode === 'pick';
  const groupTitle = (pos: Position) => (pos === 'GK' ? 'Goalkeeper' : `${POSITION_NAMES[pos]}s`);
  // Pick team: the 11 by position, then the subs. Transfers: all 15 by position.
  const groups = isPick
    ? [
        ...POSITIONS.map((pos) => ({
          title: groupTitle(pos),
          rows: picked.filter((p) => p.position === pos),
        })),
        {
          title: 'Subs',
          rows: benchPlayers.filter((p): p is SquadPlayer => p !== null),
          tone: subsTone,
        },
      ]
    : POSITIONS.map((pos) => ({
        title: pos === 'GK' ? 'Goalkeepers' : groupTitle(pos),
        rows: squadPlayers.filter((p) => p.position === pos),
      }));
  const { unlimited } = transfers;
  // FPL's numbers row: free transfers, then the points cost once past them.
  const transferStats: [string, string, string][] = [
    transfers.extra > 0
      ? [`-${transfers.cost} pts`, `Cost (${transfers.extra} extra)`, 'bg-brand text-white']
      : [
          unlimited ? 'Unlimited' : `${transfers.left} / ${transfers.free}`,
          unlimited ? 'Transfers' : 'Free transfers left',
          '',
        ],
    [`${summary.count}/${STARTERS + BENCH}`, 'Squad', ''],
    [`${formatPrice(bank)}m`, 'Bank', bank < 0 ? 'bg-brand text-white' : 'bg-[#1f7a4d] text-white'],
  ];
  /** The first position with an empty place, for Add Player. */
  const firstGap = POSITIONS.find(
    (pos) => squadPlayers.filter((p) => p.position === pos).length < SQUAD_QUOTA[pos],
  );
  const chrome = 'bg-black/[0.06] dark:bg-[#1f232c]';
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[26rem] flex-col px-2 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] sm:pb-[env(safe-area-inset-bottom)]">
      {/* Title bar. Pick Team is a tab: its title, and Transfers (red) to the right.
          Transfers sits under it: back returns to Pick Team. */}
      <header className="vt-squad-head flex min-h-[52px] shrink-0 items-center gap-2 bg-paper pb-1 pt-1">
        {!isPick && (
          <Link
            to="/squad"
            aria-label="Back to Pick Team"
            onClick={transitionClick('/squad', 'back', leave('/squad'))}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-ink no-underline hover:no-underline"
          >
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 items-center justify-center rounded-full pb-0.5 text-xl ${chrome}`}
            >
              ‹
            </span>
          </Link>
        )}
        <div className={`min-w-0 flex-1 leading-tight ${isPick ? 'pl-2' : ''}`}>
          <h1 className="m-0 text-[1.65rem] leading-none">{isPick ? 'Pick Team' : 'Transfers'}</h1>
          <p className="m-0 mt-0.5 truncate text-[0.8rem] text-ink-soft">
            GW{all.filter((g) => g.start_date <= gameweek.start_date).length} · Deadline{' '}
            {formatDeadline(gameweek.deadline)}
          </p>
        </div>
        <VersionSwitch tone="page" />
        {isPick && (
          <Link
            to="/transfers"
            onClick={transitionClick('/transfers', 'swap', leave('/transfers'))}
            className="flex min-h-tap shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-[0.95rem] font-extrabold text-white no-underline hover:no-underline"
          >
            Transfers <span aria-hidden="true">›</span>
          </Link>
        )}
      </header>

      <Notices items={notices} />

      {isPick && empty ? (
        <section className="card mt-2 text-center">
          <h2>No squad yet</h2>
          <p className="muted mb-3">Pick your 15 players on Transfers first.</p>
          <Link className="btn" to="/transfers">
            Go to transfers
          </Link>
        </section>
      ) : (
        <>
          {isPick ? (
            <ChipsCard
              userId={session.user.id}
              gameweek={gameweek}
              gameweeks={all}
              sides={sides.data ?? []}
              onNotice={setNotices}
              // The wildcard is played on Transfers, so it isn't shown here at all.
              only={['triple_captain', 'rolling_subs', 'team_bus']}
              slim
            />
          ) : (
            <div className="mb-2 flex shrink-0 items-stretch gap-1.5">
              {transferStats.map(([value, label, tone]) => (
                <div key={label} className="flex flex-1 flex-col items-center justify-center gap-1">
                  <span className={`rounded-lg px-2 py-1 text-[0.95rem] font-extrabold ${tone}`}>
                    {value}
                  </span>
                  <span className="text-center text-[0.7rem] leading-tight text-ink-soft">
                    {label}
                  </span>
                </div>
              ))}
              <div className="w-[5.75rem] shrink-0">
                <ChipsCard
                  userId={session.user.id}
                  gameweek={gameweek}
                  gameweeks={all}
                  sides={sides.data ?? []}
                  onNotice={setNotices}
                  only={['wildcard']}
                  className=""
                  slim
                />
              </div>
            </div>
          )}
          {!isPick && freeFix && (
            <p className="mb-2 rounded-xl border border-[#9cc3ea] bg-[#eaf3fc] px-3 py-1.5 text-xs font-semibold text-[#123a5e] dark:border-[#2c4f73] dark:bg-[#14263a] dark:text-[#cfe3f7]">
              Squads are now 2 GK, 5 DEF, 5 MID and 3 FWD. Changes this week to get yours there are
              free.
            </p>
          )}
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <div
              className={`flex flex-1 rounded-[10px] p-[3px] ${chrome}`}
              role="group"
              aria-label="View"
            >
              {(['pitch', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`min-h-[38px] flex-1 rounded-lg text-sm font-semibold capitalize ${view === v ? 'bg-[#14181f] text-white dark:bg-[#eceff4] dark:text-[#0e1014]' : 'text-ink-soft'}`}
                >
                  {v}
                </button>
              ))}
            </div>
            {view === 'pitch' && (
              <button
                type="button"
                onClick={() => setDataOpen(true)}
                aria-label={`Player data: ${PLAYER_DATA.find((o) => o.key === dataKey)?.label}. Change`}
                className="flex min-h-tap items-center gap-1.5 rounded-[10px] border border-line px-2.5 text-sm font-semibold"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-4 rounded-[2px] border-[1.5px] border-current"
                />
                {PLAYER_DATA.find((o) => o.key === dataKey)?.label}
                <span aria-hidden="true" className="text-[0.6rem]">
                  ▼
                </span>
              </button>
            )}
          </div>

          {view === 'pitch' && isPick ? (
            <div className="vt-squad-pitch">
              <Pitch
                rows={slots}
                bench={benchSlots}
                compact
                fieldClass={dirty ? PICK_FIELD.saving : PICK_FIELD.idle}
              />
            </div>
          ) : view === 'pitch' ? (
            <div className="vt-squad-pitch relative">
              <Pitch rows={transferRows} compact fieldClass={TRANSFER_FIELD} />
              {squadPlayers.length < STARTERS + BENCH && (
                <button
                  type="button"
                  onClick={autoFill}
                  className="absolute left-2.5 top-8 z-10 min-h-[32px] rounded-full bg-white px-3 text-xs font-extrabold text-[#14181f] shadow-card"
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
                  className="absolute right-2.5 top-8 z-10 min-h-[32px] rounded-full bg-black/55 px-3 text-xs font-extrabold text-white shadow-card"
                >
                  Reset
                </button>
              )}
            </div>
          ) : (
            <StatsTable
              rows={squadPlayers}
              groups={groups}
              columns={statColumns}
              defaultSort="pts"
              tiebreak={(p) => statPoints(p.id)}
              lead={(p) => {
                const slot = benchSlot(p.id);
                const badge = !isPick
                  ? null
                  : captainId === p.id
                    ? 'C'
                    : viceId === p.id
                      ? 'V'
                      : null;
                const side = sideById.get(p.side_id)?.short_name ?? '';
                return (
                  <span className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`${p.name}: stats`}
                      onClick={() => setStatsFor(p.id)}
                      className="-ml-2 flex h-11 w-7 shrink-0 items-center justify-center font-serif font-bold italic text-ink-soft"
                    >
                      i
                    </button>
                    <button
                      type="button"
                      onClick={() => setFocus(p.id)}
                      className="flex min-h-tap min-w-0 flex-1 flex-col justify-center text-left"
                    >
                      <span className="truncate font-bold">{p.name}</span>
                      <span className="muted truncate text-xs">
                        {isPick && slot >= 0
                          ? `${slot === 0 ? 'Sub GK' : `Sub ${slot}`} · ${side}`
                          : `${side} · ${nextFor(p)}`}
                      </span>
                    </button>
                    {badge && (
                      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-ink text-[0.62rem] font-extrabold text-surface">
                        {badge}
                      </span>
                    )}
                  </span>
                );
              }}
            />
          )}
        </>
      )}

      {swapping && (
        <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[25rem] items-center justify-between gap-2 rounded-xl bg-[#16181d] px-3 py-2 text-sm font-semibold text-white shadow-card">
          <span>Tap who {swapping.name} swaps with</span>
          <button
            type="button"
            className="min-h-tap rounded-full px-3 font-display font-bold uppercase text-[#ffd400]"
            onClick={() => setSwapFrom(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Transfers, as FPL: Add Player for an empty place, Next to review and confirm. */}
      {!isPick && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-2 mt-auto flex gap-2.5 bg-paper px-2.5 pb-2 pt-2.5 sm:bottom-0 sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={!firstGap}
            onClick={() => firstGap && setPicker({ positions: [firstGap] })}
            className="min-h-[46px] flex-1 rounded-full bg-[#e83434] text-base font-extrabold text-white disabled:bg-black/[0.06] disabled:text-ink-soft dark:disabled:bg-[#1f232c]"
          >
            Add Player
          </button>
          {firstSquad ? (
            // A first squad saves in one tap; anything wrong shows on the sheet.
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => (problems.length ? setConfirmOpen(true) : void save())}
              className="min-h-[46px] flex-1 rounded-full bg-[#1f7a4d] text-base font-extrabold text-white disabled:border-[1.5px] disabled:border-line disabled:bg-transparent disabled:text-ink-soft"
            >
              {saving ? 'Saving' : 'Save squad'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setConfirmOpen(true)}
              className="min-h-[46px] flex-1 rounded-full bg-[#14181f] text-base font-extrabold text-white disabled:border-[1.5px] disabled:border-line disabled:bg-transparent disabled:text-ink-soft dark:bg-[#eceff4] dark:text-[#0e1014] dark:disabled:bg-transparent"
            >
              Next
            </button>
          )}
        </div>
      )}

      {/* Pick team: only once something has changed, as in FPL. */}
      {isPick && dirty && !empty && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-2 mt-auto bg-paper px-2.5 pb-2 pt-2 sm:bottom-0 sm:pb-[max(0.4rem,env(safe-area-inset-bottom))]">
          {showProblems && problemsOpen && (
            <ul className="mb-2 list-disc space-y-1 rounded-xl border border-[#f2c27a] bg-[#fff4e5] py-2 pl-7 pr-3 text-sm font-semibold text-[#6b3d00] dark:border-[#7a5a24] dark:bg-[#2b2113] dark:text-[#f5d9a8]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {/* A broken rule sits beside Save, so the pitch doesn't move. */}
          <div className="flex gap-2">
            {showProblems && (
              <button
                type="button"
                onClick={() => setProblemsOpen(!problemsOpen)}
                aria-expanded={problemsOpen}
                className="flex min-h-[46px] min-w-0 flex-1 items-center gap-1.5 text-left text-[0.8rem] font-semibold leading-tight text-[#8a4b00] dark:text-[#ffc773]"
              >
                <span aria-hidden="true">⚠</span>
                <span className="line-clamp-2 min-w-0">
                  {problems[0]}
                  {problems.length > 1 && ` (+${problems.length - 1} more)`}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className={`min-h-[46px] rounded-full bg-[#e83434] text-base font-extrabold text-white disabled:opacity-60 ${showProblems ? 'shrink-0 px-5' : 'w-full'}`}
            >
              {saving ? 'Saving' : showProblems ? 'Save' : 'Save Your Team'}
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <Sheet title="Confirm Transfers" onClose={() => setConfirmOpen(false)}>
          <p className="muted mb-3 text-sm">
            Gameweek {all.filter((g) => g.start_date <= gameweek.start_date).length} • Deadline:{' '}
            {formatDeadline(gameweek.deadline)}
          </p>
          {moves.length ? (
            <>
              <div className="grid grid-cols-[1fr_1.5rem_1fr] border-b border-line pb-1.5 text-xs font-bold text-ink-soft">
                <span>OUT</span>
                <span />
                <span>IN</span>
              </div>
              {moves.map(([out, inn], i) => (
                <div
                  key={i}
                  className="grid min-h-[58px] grid-cols-[1fr_1.5rem_1fr] items-center border-b border-line"
                >
                  <MoveCell
                    player={out}
                    side={out ? sideById.get(out.side_id)?.short_name : undefined}
                  />
                  <span aria-hidden="true" className="text-center text-ink-soft">
                    →
                  </span>
                  <MoveCell
                    player={inn}
                    side={inn ? sideById.get(inn.side_id)?.short_name : undefined}
                  />
                </div>
              ))}
            </>
          ) : (
            <p className="mb-0">
              {previousIds.length
                ? 'No transfers: just your line-up has changed.'
                : `Your first squad: ${squadPlayers.length} players.`}
            </p>
          )}
          <dl className="mt-4 space-y-2.5 text-sm">
            {(
              [
                [
                  'Transfers this gameweek',
                  unlimited
                    ? wildcard
                      ? 'Unlimited (wildcard)'
                      : 'Unlimited'
                    : `${transfers.used} (${transfers.free} free)`,
                ],
                ...(transfers.extra > 0
                  ? ([['Points cost', `-${transfers.cost} pts`]] as const)
                  : []),
                ['Bank after', `${formatPrice(bank)}m`],
                ['Then', 'On to Pick Team'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="m-0 font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          {problems.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 rounded-xl border border-[#f2c27a] bg-[#fff4e5] py-2 pl-7 pr-3 text-sm font-semibold text-[#6b3d00] dark:border-[#7a5a24] dark:bg-[#2b2113] dark:text-[#f5d9a8]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <p className="mb-3 mt-4 text-xs leading-snug text-ink-soft">
            You can change your team again until the deadline. Each transfer past your free ones
            costs {s.transfer_hit ?? 4} points off this gameweek&apos;s score. Unused free transfers
            carry over, up to {s.max_free_transfers ?? 5}.
          </p>
          <button
            type="button"
            disabled={saving || problems.length > 0}
            onClick={() => {
              setConfirmOpen(false);
              void save();
            }}
            className="min-h-[48px] w-full rounded-full bg-[#e83434] text-base font-extrabold text-white disabled:opacity-60"
          >
            {saving ? 'Saving' : problems.length ? 'Fix the above first' : 'Confirm Transfers'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="mt-1 min-h-tap w-full text-sm font-bold text-ink-soft"
          >
            Back to Transfers
          </button>
        </Sheet>
      )}

      {dataOpen && (
        <Sheet title="Player Data" onClose={() => setDataOpen(false)}>
          <div role="radiogroup" aria-label="Player data">
            {PLAYER_DATA.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={dataKey === o.key}
                onClick={() => chooseData(o.key)}
                className="flex min-h-[52px] w-full items-center border-b border-line text-left"
              >
                <span className="flex flex-1 flex-col">
                  <span className="text-[1.05rem] font-bold">{o.label}</span>
                  <span className="text-xs text-ink-soft">{o.help}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-ink"
                >
                  {dataKey === o.key && <span className="h-[11px] w-[11px] rounded-full bg-ink" />}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3.5 text-xs leading-snug text-ink-soft">
            FPL&apos;s FDR and Selling Price aren&apos;t here: we don&apos;t have opponents&apos;
            league tables, and players sell at their current price.
          </p>
        </Sheet>
      )}

      {overlays}
      <PhoneTabBar guard={leave('')} />
    </div>
  );
}

// Pick team's pitch: the screen's height less the title bar, gameweek line,
// chips, view switch, subs and (once changed) the save button, with a floor so
// short screens scroll rather than squash.
// Phones: the tab bar (4rem) is under the page too; laptops keep a pitch's shape.
const PICK_FIELD = {
  idle: 'h-[max(17rem,calc(100dvh-22rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)))] sm:h-auto sm:aspect-[590/954]',
  saving:
    'h-[max(17rem,calc(100dvh-25.75rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)))] sm:h-auto sm:aspect-[590/954]',
};

// Transfers: all 15 on the pitch, no subs strip; the rest as Pick team's.
const TRANSFER_FIELD =
  'h-[max(20rem,calc(100dvh-19.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)))] sm:h-auto sm:aspect-[590/954]';

/** One side of a transfer on the confirm sheet: name, then position, side and price. */
function MoveCell({ player, side }: { player: MovePlayer | null; side?: string }) {
  if (!player) return <span className="text-ink-soft">-</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-bold">{player.name}</span>
      <span className="truncate text-xs text-ink-soft">
        {player.position} · {side} · {formatPrice(player.price)}m
      </span>
    </span>
  );
}
