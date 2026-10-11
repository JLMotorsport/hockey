import type { ReactNode } from 'react';
import { useTransitionNavigate } from '@/lib/navTransition';

/** A V3 title bar with a back button (to Home unless told otherwise). */
export function BackBar({
  children,
  to = '/',
  right,
}: {
  children: ReactNode;
  to?: string;
  right?: ReactNode;
}) {
  const go = useTransitionNavigate();
  return (
    <header className="flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-1">
      <button
        type="button"
        aria-label="Back"
        onClick={() => go(to, 'back')}
        className="v3-icon text-lg"
      >
        ‹
      </button>
      <span className="min-w-0 flex-1 text-center">{children}</span>
      {right ?? <span className="w-11 shrink-0" />}
    </header>
  );
}

/** A row of pill filters, one chosen. */
export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1.5 overflow-x-auto px-3.5 pb-2.5 [scrollbar-width:none]"
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`v3-disp min-h-[44px] shrink-0 rounded-full px-4 text-[13px] ${value === key ? 'bg-white text-[#05070c]' : 'border border-white/10 bg-white/[0.05] text-[rgb(var(--v3-mut))]'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
