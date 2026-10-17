import { useState } from 'react';
import { Loading } from '@/components/ui';
import { CHIPS } from '@/lib/chips';
import { useSettings } from '@/lib/queries';
import { RULES_TABLE } from '@/lib/scoring';
import { formatPrice, transferRule } from '@/lib/squad';
import { BackBar, Pills } from './V3Bits';

const TABS = [
  ['points', 'Points'],
  ['squad', 'Squad'],
  ['chips', 'Chips'],
  ['deadlines', 'Deadlines'],
] as const;
type Tab = (typeof TABS)[number][0];

/** V3 How it works (board "Rules"): the points table, squad rules, chips and deadlines. */
export function V3Rules() {
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('points');
  const s = settings.data;

  return (
    <div className="mx-auto max-w-[26rem] pb-4">
      <BackBar>
        <span className="v3-disp text-[26px]">How it works</span>
      </BackBar>
      <Pills label="Topic" options={TABS} value={tab} onChange={setTab} />

      {tab === 'points' && (
        <ul className="v3-glass mx-3.5 rounded-[20px] px-3.5">
          {RULES_TABLE.map(([label, pts], i) => {
            const minus = pts.startsWith('-');
            return (
              <li
                key={label}
                className={`flex min-h-[44px] items-center gap-3 ${i ? 'border-t border-white/10' : ''}`}
              >
                <span className="flex-1 text-[13px]">{label}</span>
                <span
                  className={`v3-disp v3-num min-w-[44px] rounded-[10px] px-2 py-[3px] text-center text-[17px] ${minus ? 'bg-[rgb(255_51_71/.12)] text-[#ff8a97]' : 'bg-[rgb(63_242_168/.12)] text-[rgb(var(--v3-mint))]'}`}
                >
                  {pts.replace('-', '−').replace('x', '×')}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'squad' &&
        (s ? (
          <Card
            items={[
              `${s.squad_size} players from any Felixstowe adult side: a starting 11 and 4 subs.`,
              `Start 1 goalkeeper in a formation: ${s.formations.join(', ')} (defenders-midfielders-forwards).`,
              "Subs: a sub goalkeeper, then 3 outfield subs in order. Once the weekend is over, a starter who didn't play is replaced by the first sub who did, as long as the team still lines up in an allowed formation. Only the 11 who count score.",
              `Budget of ${formatPrice(s.budget)}m.`,
              `Max ${s.max_per_side} players from any one side.`,
              transferRule(s),
              'If your player turns out for another Felixstowe side that weekend, those points count too.',
            ]}
          />
        ) : (
          <Loading />
        ))}

      {tab === 'chips' && (
        <>
          <p className="mx-[18px] mb-2.5 text-[13px] leading-relaxed text-[rgb(var(--v3-mut))]">
            Play one before a gameweek&apos;s deadline from Pick team. One chip per gameweek, each
            once a season, apart from the wildcard: one before New Year and one after.
          </p>
          <ul className="flex flex-col gap-2 px-3.5">
            {CHIPS.map((c) => (
              <li key={c.key} className="v3-glass rounded-[20px] p-3.5">
                <span className="v3-disp block text-[19px]">{c.name}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-[rgb(var(--v3-mut))]">
                  {c.description}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'deadlines' && (
        <Card
          items={[
            "Squads lock at each gameweek's deadline: an hour before its first game.",
            'Your squad carries over each week until you change it.',
            "Other people's squads are revealed once the deadline passes.",
            'Scores come from England Hockey after each game. Players show their fixture until their match has synced.',
          ]}
        />
      )}
    </div>
  );
}

function Card({ items }: { items: string[] }) {
  return (
    <ul className="v3-glass mx-3.5 rounded-[20px] px-3.5">
      {items.map((t, i) => (
        <li
          key={t}
          className={`flex gap-3 py-3 text-[13px] leading-relaxed ${i ? 'border-t border-white/10' : ''}`}
        >
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--v3-red))] shadow-[0_0_8px_rgb(255_51_71/.8)]" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
