import type { ReactNode } from 'react';
import type { Check, Tone } from '@/lib/managers';

/** Shared pieces of the managers' screens, matching the approved design. */

export const panel = 'rounded-2xl bg-surface shadow-card';

const TONES: Record<Tone, string> = {
  ok: 'bg-[#e6f4ec] dark:bg-[#123d27] text-[#155c39] dark:text-[#8ee0b0]',
  warn: 'bg-[#fff1dc] dark:bg-[#4a3010] text-[#7a4600] dark:text-[#ffc773]',
  bad: 'bg-[#fde8e8] dark:bg-[#4a1616] text-[#9b1c1c] dark:text-[#ff9a9a]',
  muted: 'bg-line text-[#3a404b] dark:text-[#c8ced8]',
};

export function Pill({ check }: { check: Check }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${TONES[check.tone]}`}>
      {check.label}
    </span>
  );
}

export function SideTag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block min-w-[2.6rem] shrink-0 rounded-md bg-[#16181d] px-1.5 dark:bg-[#3a404b] py-0.5 text-center font-display text-sm font-extrabold text-white ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-tap shrink-0 rounded-full px-3.5 text-sm font-bold lg:min-h-[36px] ${on ? 'bg-[#16181d] text-white dark:bg-ink dark:text-paper' : 'bg-surface text-ink ring-1 ring-line'}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-tap min-w-tap shrink-0 items-center justify-center disabled:opacity-50"
    >
      <span
        className={`relative block h-7 w-12 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-[#c4c9d2]'}`}
      >
        <span
          className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${checked ? 'left-[23px]' : 'left-[3px]'}`}
        />
      </span>
    </button>
  );
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="m-0 font-display text-3xl font-extrabold uppercase leading-none lg:text-4xl">
          {title}
        </h1>
        {sub && <p className="muted mt-1.5 text-sm lg:text-[15px]">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A row of chips that scrolls sideways on a phone. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
      {children}
    </div>
  );
}

export const POSITION_BUTTON =
  'min-h-tap rounded-[10px] font-display text-base font-extrabold lg:min-h-[36px] lg:min-w-[48px] lg:text-sm';
