import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { CalendarIcon, HomeIcon, MenuIcon, PitchIcon, SwapIcon, TrophyIcon } from './icons';
import { Sheet } from './Sheet';

function Crest({ className = '' }: { className?: string }) {
  // The crest is red on transparent; shown white on the red header.
  return <img src="/crest.png" alt="" className={`brightness-0 invert ${className}`} />;
}

function TopLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3 py-1.5 font-display text-[0.95rem] font-bold uppercase tracking-wide text-white no-underline hover:bg-white/15 hover:no-underline ${isActive ? 'bg-white/20' : ''}`
      }
    >
      {children}
    </NavLink>
  );
}

function Tab({ to, icon, children }: { to: string; icon: ReactNode; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 font-display text-[0.7rem] font-bold uppercase no-underline hover:no-underline ${isActive ? 'text-brand' : 'text-ink-soft'}`
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { session, profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 bg-brand text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-white no-underline hover:no-underline"
          >
            <Crest className="h-10 w-10" />
            <span className="font-display leading-none">
              <span className="block text-xl font-extrabold uppercase tracking-tight">
                Fantasy Hockey
              </span>
              <span className="block text-xs font-semibold uppercase tracking-widest text-white/80">
                Felixstowe HC
              </span>
            </span>
          </Link>
          <nav className="hidden flex-wrap items-center gap-1 sm:flex">
            {session && <TopLink to="/dashboard">My team</TopLink>}
            {session && <TopLink to="/squad">Pick</TopLink>}
            <TopLink to="/table">Table</TopLink>
            <TopLink to="/players">Players</TopLink>
            <TopLink to="/fixtures">Fixtures</TopLink>
            <TopLink to="/rules">Rules</TopLink>
            {profile?.is_admin && <TopLink to="/manage">Manage</TopLink>}
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

      <main className="mx-auto max-w-5xl px-4 pb-10">
        <Outlet />
      </main>
      <footer className="muted mx-auto hidden max-w-5xl px-4 pb-8 text-xs sm:block">
        Fixtures, line-ups, goals and cards from England Hockey.
      </footer>

      {/* Phone tab bar, as on the Premier League app. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgb(0_0_0/0.06)] sm:hidden">
        {session ? (
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
          className="flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 font-display text-[0.7rem] font-bold uppercase text-ink-soft"
        >
          <MenuIcon />
          More
        </button>
      </nav>

      {menuOpen && (
        <Sheet title="Menu" onClose={() => setMenuOpen(false)}>
          <ul className="divide-y divide-line">
            {[
              ['/players', 'Players'],
              ['/rules', 'How it works'],
              ...(profile?.is_admin ? [['/manage', 'Manager dashboard']] : []),
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
