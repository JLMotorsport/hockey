import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { VersionSwitch } from '@/components/VersionSwitch';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTransitionClick } from '@/lib/navTransition';
import { useSides } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { BUILD_LABEL } from '@/lib/version';

/** V3 More (board "More"): your team, settings, the design switch and the rest of the league. */
export function V3More() {
  const { session, profile } = useAuth();
  const sides = useSides();
  const click = useTransitionClick();
  const side = sides.data?.find((s) => s.id === profile?.side_id);
  const initials = (profile?.team_name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const link = (to: string, label: string) => (
    <Link
      key={to}
      to={to}
      onClick={click(to, 'forward')}
      className="flex min-h-[52px] items-center justify-between text-[15px] text-white no-underline hover:no-underline"
    >
      {label}
      <span className="text-[rgb(var(--v3-mut))]">›</span>
    </Link>
  );

  return (
    <div className="mx-auto max-w-[26rem] pb-4">
      <header className="px-[18px] pb-2.5 pt-1.5">
        <span className="v3-disp text-[26px]">More</span>
      </header>

      {session && profile ? (
        <Link
          to="/account"
          onClick={click('/account', 'forward')}
          className="v3-glass mx-3.5 flex items-center gap-3 rounded-[22px] p-3.5 text-white no-underline hover:no-underline"
        >
          <span className="v3-disp v3-red v3-glow flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-lg">
            {initials || 'FHC'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="v3-disp block truncate text-2xl">{profile.team_name}</span>
            <span className="block truncate text-xs text-[rgb(var(--v3-mut))]">
              {profile.display_name}
              {side ? ` · plays for ${side.short_name}` : ''}
            </span>
          </span>
          <span className="v3-icon text-sm" aria-hidden="true">
            ✎
          </span>
        </Link>
      ) : (
        <div className="mx-3.5 flex gap-2">
          <Link to="/login" className="v3-btn v3-red v3-glow flex-1 text-white no-underline">
            Log in
          </Link>
          <Link
            to="/register"
            className="v3-btn flex-1 border border-white/15 bg-white/[0.05] text-white no-underline"
          >
            Join the league
          </Link>
        </div>
      )}

      <Section title="Settings">
        {session && (
          <Link
            to="/account"
            onClick={click('/account', 'forward')}
            className="flex min-h-[52px] items-center justify-between text-[15px] text-white no-underline hover:no-underline"
          >
            Side you play for
            <span className="text-[13px] text-[rgb(var(--v3-mut))]">
              {side?.short_name ?? 'Not set'} ›
            </span>
          </Link>
        )}
        <div className="flex min-h-[56px] items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-[15px]">Design</span>
            <span className="text-[10px] text-[rgb(var(--v3-mut))]">Beta {BUILD_LABEL}</span>
          </span>
          <VersionSwitch tone="v3" />
        </div>
      </Section>

      <Section title="League">
        {link('/fixtures', 'Fixtures and results')}
        {link('/team-of-the-week', 'Team of the week')}
        {link('/players', 'Players')}
        {link('/rules', 'How it works')}
        {(profile?.is_admin || profile?.is_super) && link('/managers', 'Managers area')}
      </Section>

      {session && (
        <button
          type="button"
          onClick={() => void supabase?.auth.signOut()}
          className="mt-3.5 min-h-[44px] w-full text-center text-sm font-semibold text-[#ff8a97]"
        >
          Log out
        </button>
      )}
      {session && !profile?.is_super && (
        <Link
          to="/account/delete"
          className="flex min-h-[44px] items-center justify-center text-[13px] text-[rgb(var(--v3-mut))] underline underline-offset-[3px]"
        >
          Delete account
        </Link>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="v3-cap mx-[18px] mb-2 mt-4">{title}</div>
      <div className="v3-glass mx-3.5 divide-y divide-white/10 rounded-[20px] px-3.5">
        {children}
      </div>
    </>
  );
}
