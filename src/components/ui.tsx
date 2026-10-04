import type { ReactNode } from 'react';
import type { Position } from '@/lib/scoring';

const POS_COLOURS: Record<Position, string> = {
  GK: 'bg-[#7a4fb5]',
  DEF: 'bg-[#2a7ab0]',
  MID: 'bg-[#1f8a5b]',
  FWD: 'bg-[#c0482b]',
};

export function PosBadge({ position }: { position: Position }) {
  return (
    <span
      className={`inline-block min-w-[2.8em] rounded px-1 text-center text-[0.7rem] font-bold text-white ${POS_COLOURS[position]}`}
    >
      {position}
    </span>
  );
}

export function CaptainBadge() {
  return (
    <span
      title="Captain"
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[0.7rem] font-bold text-[#17202e]"
    >
      C
    </span>
  );
}

export type Notice = { kind: 'success' | 'error' | 'info'; text: string };

export function Notices({ items }: { items: Notice[] }) {
  if (!items.length) return null;
  const border = {
    success: 'border-l-green-700',
    error: 'border-l-red-700',
    info: 'border-l-brand',
  };
  return (
    <div role="status" className="my-3 space-y-2">
      {items.map((n, i) => (
        <div
          key={i}
          className={`rounded-lg border border-line border-l-4 bg-surface px-3 py-2 ${border[n.kind]}`}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <p className="muted my-6">{label}...</p>;
}

export function ErrorText({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : 'Something went wrong.';
  return <p className="my-6 text-red-700">{text}</p>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <span className="block text-3xl font-bold">{value}</span>
      <span className="muted text-sm">{label}</span>
    </div>
  );
}
