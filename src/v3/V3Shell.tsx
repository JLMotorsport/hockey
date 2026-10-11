import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { HomeIcon, MenuIcon, PitchIcon, TrophyIcon } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { VersionSwitch } from '@/components/VersionSwitch';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTransitionClick } from '@/lib/navTransition';
import { supabase } from '@/lib/supabase';
import { BUILD_LABEL } from '@/lib/version';

/** The V3 frame: night background, and the floating dock on pages that have it. */
export function V3Shell({ children, dock = true }: { children: ReactNode; dock?: boolean }) {
  // The phone's status bar matches the dark page.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute('content');
    meta?.setAttribute('content', '#05070c');
    return () => {
      if (before) meta?.setAttribute('content', before);
    };
  }, []);
  return (
    <div className="v3 relative pt-[env(safe-area-inset-top)]">
      {children}
      {dock && (
        <>
          <div className="h-[calc(96px+env(safe-area-inset-bottom))]" />
          <Dock />
        </>
      )}
    </div>
  );
}

/** A V2 screen not rebuilt for V3 yet, shown inside the V3 frame. */
export function V3Fallback({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[26rem] px-4 pb-6 pt-2">{children}</main>;
}

function Dock() {
  const { session, profile } = useAuth();
  const [more, setMore] = useState(false);
  const transitionClick = useTransitionClick();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tab = (to: string, label: string, icon: ReactNode) => (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={transitionClick(to, 'swap')}
      className={({ isActive }) =>
        `flex min-h-[48px] min-w-[52px] flex-col items-center justify-center gap-0.5 text-[10px] font-semibold no-underline hover:no-underline [&>svg]:h-[22px] [&>svg]:w-[22px] ${isActive ? 'text-white' : 'text-[#7d8698]'}`
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          {label}
          <span
            className={`h-1 w-1 rounded-full ${isActive ? 'bg-[rgb(var(--v3-red))] shadow-[0_0_8px_rgb(var(--v3-red))]' : ''}`}
          />
        </>
      )}
    </NavLink>
  );
  const go = (to: string) => {
    setMore(false);
    navigate(to);
  };
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-3.5 bottom-[calc(10px+env(safe-area-inset-bottom))] z-30 mx-auto flex h-[62px] max-w-[26rem] items-center justify-around rounded-3xl border border-white/10 bg-[rgb(14_17_24/.82)] shadow-[0_20px_50px_-10px_rgb(0_0_0/.8)] backdrop-blur-xl"
      >
        {tab('/', 'Home', <HomeIcon />)}
        {session && tab('/dashboard', 'Points', <PitchIcon />)}
        {session && (
          <Link
            to="/squad"
            onClick={transitionClick('/squad', 'forward')}
            aria-current={pathname === '/squad' ? 'page' : undefined}
            className="v3-red v3-glow v3-disp -mt-7 flex h-[54px] w-[54px] items-center justify-center rounded-[18px] text-[14px] text-white no-underline hover:no-underline"
          >
            Pick
          </Link>
        )}
        {tab('/table', 'Table', <TrophyIcon />)}
        <button
          type="button"
          onClick={() => setMore(true)}
          className="flex min-h-[48px] min-w-[52px] flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-[#7d8698] [&>svg]:h-[22px] [&>svg]:w-[22px]"
        >
          <MenuIcon />
          More
          <span className="h-1 w-1" />
        </button>
      </nav>
      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div>
            <ul className="divide-y divide-white/10">
              {[
                ['/fixtures', 'Fixtures and results'],
                ['/team-of-the-week', 'Team of the week'],
                ['/players', 'Players'],
                ['/rules', 'How it works'],
                ...(session ? [['/account', 'Account']] : [['/login', 'Log in']]),
                ...(profile?.is_admin ? [['/managers', 'Managers area']] : []),
              ].map(([to, label]) => (
                <li key={to}>
                  <button
                    type="button"
                    onClick={() => go(to!)}
                    className="flex min-h-[52px] w-full items-center justify-between text-left text-[15px]"
                  >
                    {label}
                    <span className="text-[rgb(var(--v3-mut))]">›</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <span className="v3-cap">Design · BETA {BUILD_LABEL}</span>
              <VersionSwitch tone="v3" />
            </div>
            {session && (
              <button
                type="button"
                onClick={() => {
                  setMore(false);
                  void supabase?.auth.signOut();
                }}
                className="mt-4 min-h-[44px] w-full text-center text-sm font-semibold text-[#ff8a97]"
              >
                Log out
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
