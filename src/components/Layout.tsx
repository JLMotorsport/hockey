import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { CalendarIcon, HomeIcon, MenuIcon, PitchIcon, SwapIcon, TrophyIcon } from './icons';
import { Sheet } from './Sheet';
import { BUILD_COMMIT, BUILD_LABEL } from '@/lib/version';
import { VersionSwitch } from './VersionSwitch';
import { useUiVersion } from '@/lib/uiVersion';

function Crest({ className = '' }: { className?: string }) {
  // The crest is red on transparent; shown white on the red header.
  return <img src="/crest.png" alt="" className={`brightness-0 invert ${className}`} />;
}

/** Pick covers both squad pages: Pick team (/squad) and Transfers. */
function useAlsoActive(to: string) {
  const { pathname } = useLocation();
  return to === '/squad' && pathname.startsWith('/transfers');
}

function TopLink({ to, children }: { to: string; children: string }) {
  const also = useAlsoActive(to);
  return (
    <NavLink
      end={to === '/'}
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3 py-1.5 font-display text-[0.95rem] font-bold uppercase tracking-wide text-white no-underline hover:bg-white/15 hover:no-underline ${isActive || also ? 'bg-white/20' : ''}`
      }
    >
      {children}
    </NavLink>
  );
}

function Tab({ to, icon, children }: { to: string; icon: ReactNode; children: string }) {
  const also = useAlsoActive(to);
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex h-16 flex-1 flex-col items-center justify-center gap-0.5 font-display text-[0.7rem] font-bold uppercase no-underline hover:no-underline ${isActive || also ? 'text-brand' : 'text-ink-soft'}`
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

export function Layout({ children }: { children?: ReactNode } = {}) {
  const { session, profile } = useAuth();
  const v2 = useUiVersion() === 'v2';
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 bg-brand text-white shadow-md">
        {/* Still being built: BETA and the build in the bar's top-right corner on phones. */}
        <span
          title={`Build ${BUILD_COMMIT}`}
          className="pointer-events-none absolute right-3 top-[3px] font-display text-[0.65rem] font-bold uppercase leading-none tracking-widest text-white opacity-70 sm:hidden"
        >
          Beta <span className="font-sans tracking-normal tabular-nums">{BUILD_LABEL}</span>
        </span>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-white no-underline hover:no-underline"
          >
            <Crest className="h-10 w-10" />
            <span className="font-display leading-none">
              <span className="block text-xl font-extrabold uppercase tracking-tight">
                Fantasy Hockey
                {/* On wider screens the corner holds the menu, so BETA sits by the title. */}
                <span
                  title={`Build ${BUILD_COMMIT}`}
                  className="ml-2 hidden align-top text-[0.7rem] font-bold tracking-widest opacity-70 sm:inline"
                >
                  Beta
                  <span className="ml-1 font-sans tracking-normal tabular-nums">{BUILD_LABEL}</span>
                </span>
              </span>
              <span className="block text-xs font-semibold uppercase tracking-widest text-white/80">
                Felixstowe HC
              </span>
            </span>
          </Link>
          {/* Testing: switch between this morning's design and the redesign. */}
          <div className="ml-auto mt-2 sm:ml-0 sm:mt-0">
            <VersionSwitch />
          </div>
          <nav className="hidden flex-wrap items-center gap-1 sm:flex">
            {session && v2 && <TopLink to="/">Home</TopLink>}
            {session && <TopLink to="/dashboard">{v2 ? 'Points' : 'My team'}</TopLink>}
            {session && !v2 && <TopLink to="/squad">Pick</TopLink>}
            <TopLink to="/table">Table</TopLink>
            <TopLink to="/team-of-the-week">TOTW</TopLink>
            <TopLink to="/players">Players</TopLink>
            <TopLink to="/fixtures">Fixtures</TopLink>
            <TopLink to="/rules">Rules</TopLink>
            {profile?.is_admin && <TopLink to="/managers">Managers</TopLink>}
            {session ? (
              <>
                <TopLink to="/account">Account</TopLink>
                <button
                  type="button"
                  className="rounded-full px-3 py-1.5 font-display text-[0.95rem] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                  onClick={() => void supabase?.auth.signOut()}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <TopLink to="/login">Log in</TopLink>
                <Link to="/register" className="btn btn-light btn-sm ml-1">
                  Join
                </Link>
              </>
            )}
          </nav>
          {!session && (
            <Link to="/register" className="btn btn-light btn-sm sm:hidden">
              Join
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-10">{children ?? <Outlet />}</main>
      <footer className="muted mx-auto hidden max-w-5xl px-4 pb-8 text-xs sm:block">
        Fixtures, line-ups, goals and cards from England Hockey.
      </footer>

      {/* Phone tab bar, as on the Premier League app. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgb(0_0_0/0.06)] sm:hidden">
        {session && v2 ? (
          // V2, as FPL: Home holds Pick Team and Transfers; My Team becomes Points.
          <>
            <Tab to="/" icon={<HomeIcon />}>
              Home
            </Tab>
            <Tab to="/dashboard" icon={<PitchIcon />}>
              Points
            </Tab>
          </>
        ) : session ? (
          <>
            <Tab to="/dashboard" icon={<PitchIcon />}>
              My team
            </Tab>
            <Tab to="/squad" icon={<SwapIcon />}>
              Pick
            </Tab>
          </>
        ) : (
          <Tab to="/" icon={<HomeIcon />}>
            Home
          </Tab>
        )}
        <Tab to="/table" icon={<TrophyIcon />}>
          Table
        </Tab>
        <Tab to="/fixtures" icon={<CalendarIcon />}>
          Fixtures
        </Tab>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-16 flex-1 flex-col items-center justify-center gap-0.5 font-display text-[0.7rem] font-bold uppercase text-ink-soft"
        >
          <MenuIcon />
          More
        </button>
      </nav>

      {menuOpen && (
        <Sheet title="Menu" onClose={() => setMenuOpen(false)}>
          <ul className="divide-y divide-line">
            {[
              ['/team-of-the-week', 'Team of the week'],
              ['/players', 'Players'],
              ['/rules', 'How it works'],
              ...(profile?.is_admin ? [['/managers', 'Managers area']] : []),
              ...(session
                ? [['/account', 'Account']]
                : [
                    ['/login', 'Log in'],
                    ['/register', 'Join the league'],
                  ]),
            ].map(([to, label]) => (
              <li key={to}>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full items-center font-display text-lg font-bold uppercase"
                  onClick={() => go(to!)}
                >
                  {label}
                </button>
              </li>
            ))}
            {session && (
              <li>
                <button
                  type="button"
                  className="flex min-h-[52px] w-full items-center font-display text-lg font-bold uppercase text-brand"
                  onClick={() => {
                    setMenuOpen(false);
                    void supabase?.auth.signOut();
                  }}
                >
                  Log out
                </button>
              </li>
            )}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
