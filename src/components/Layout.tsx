import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { signOut } from '@/lib/push';
import {
  CalendarIcon,
  HomeIcon,
  MenuIcon,
  PitchIcon,
  ShirtIcon,
  SwapIcon,
  TrophyIcon,
} from './icons';
import { Sheet } from './Sheet';
import { BUILD_COMMIT, BUILD_LABEL } from '@/lib/version';
import { VersionSwitch } from './VersionSwitch';
import { useTransitionClick } from '@/lib/navTransition';
import { useUiVersion } from '@/lib/uiVersion';
import { HeaderSlot } from './headerSlot';

const ownTitleBar = (pathname: string) => /^\/(squad|transfers)(\/|$)/.test(pathname);

function Crest({ className = '' }: { className?: string }) {
  // The crest is red on transparent; shown white on the red header.
  return <img src="/crest.png" alt="" className={`brightness-0 invert ${className}`} />;
}

/** Pick Team covers Transfers too; Table covers someone's team. */
function useAlsoActive(to: string) {
  const { pathname } = useLocation();
  // Someone's team is opened from the Table, so Table stays lit there.
  return (
    (to === '/squad' && pathname.startsWith('/transfers')) ||
    (to === '/table' && pathname.startsWith('/teams/'))
  );
}

function TopLink({ to, children }: { to: string; children: string }) {
  const transitionClick = useTransitionClick();
  const also = useAlsoActive(to);
  return (
    <NavLink
      onClick={transitionClick(to, 'swap')}
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

type Guard = (e: { preventDefault: () => void }) => void;

function Tab({
  to,
  icon,
  children,
  guard,
}: {
  to: string;
  icon: ReactNode;
  children: string;
  guard?: Guard;
}) {
  const transitionClick = useTransitionClick();
  const also = useAlsoActive(to);
  return (
    <NavLink
      onClick={transitionClick(to, 'swap', guard)}
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap font-display text-[0.7rem] font-bold uppercase no-underline hover:no-underline ${isActive || also ? 'text-brand' : 'text-ink-soft'}`
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
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Pick team and Transfers (V2): full screens of their own, their title bar in
  // this same red header (the same element, so it never leaves the screen).
  const own = v2 && !children && ownTitleBar(pathname);

  return (
    <HeaderSlot.Provider value={slot}>
      <div className={own ? '' : 'min-h-screen pb-20 sm:pb-0'}>
        {/* The same header on every page (Pick team's title goes into the slot), so
            it never leaves the screen and iPhone keeps the status bar red. */}
        <header className="sticky top-0 z-30 bg-brand text-white shadow-md">
          {own ? (
            <div ref={setSlot} className="mx-auto max-w-[26rem] px-2" />
          ) : (
            <>
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
                        <span className="ml-1 font-sans tracking-normal tabular-nums">
                          {BUILD_LABEL}
                        </span>
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
                  {session && <TopLink to="/squad">{v2 ? 'Pick Team' : 'Pick'}</TopLink>}
                  <TopLink to="/table">Table</TopLink>
                  <TopLink to="/team-of-the-week">TOTW</TopLink>
                  <TopLink to="/players">Players</TopLink>
                  <TopLink to="/fixtures">Fixtures</TopLink>
                  <TopLink to="/rules">Rules</TopLink>
                  {(profile?.is_admin || profile?.is_super) && (
                    <TopLink to="/managers">Managers</TopLink>
                  )}
                  {session ? (
                    <>
                      <TopLink to="/account">Account</TopLink>
                      <button
                        type="button"
                        className="rounded-full px-3 py-1.5 font-display text-[0.95rem] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                        onClick={() => void signOut()}
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
            </>
          )}
        </header>

        {own ? (
          <Outlet />
        ) : (
          <>
            <main className="mx-auto max-w-5xl px-4 pb-10">{children ?? <Outlet />}</main>
            <footer className="muted mx-auto hidden max-w-5xl px-4 pb-8 text-xs sm:block">
              Fixtures, line-ups, goals and cards from England Hockey.
            </footer>
            <PhoneTabBar />
          </>
        )}
      </div>
    </HeaderSlot.Provider>
  );
}

/**
 * The phone tab bar and its More menu: on every page, Pick Team and Transfers
 * too. `guard` can stop a tab being followed (unsaved changes).
 */
export function PhoneTabBar({ guard }: { guard?: Guard } = {}) {
  const { session, profile } = useAuth();
  const v2 = useUiVersion() === 'v2';
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };
  return (
    <>
      {/* Phone tab bar, as on the Premier League app. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgb(0_0_0/0.06)] sm:hidden">
        {session && v2 ? (
          // V2, as FPL: Home, Points, then Pick Team (Transfers is under it).
          <>
            <Tab guard={guard} to="/" icon={<HomeIcon />}>
              Home
            </Tab>
            <Tab guard={guard} to="/dashboard" icon={<PitchIcon />}>
              Points
            </Tab>
            <Tab guard={guard} to="/squad" icon={<ShirtIcon />}>
              Pick Team
            </Tab>
          </>
        ) : session ? (
          <>
            <Tab guard={guard} to="/dashboard" icon={<PitchIcon />}>
              My team
            </Tab>
            <Tab guard={guard} to="/squad" icon={<SwapIcon />}>
              Pick
            </Tab>
          </>
        ) : (
          <Tab guard={guard} to="/" icon={<HomeIcon />}>
            Home
          </Tab>
        )}
        <Tab guard={guard} to="/table" icon={<TrophyIcon />}>
          Table
        </Tab>
        <Tab guard={guard} to="/fixtures" icon={<CalendarIcon />}>
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
              ...(profile?.is_admin || profile?.is_super ? [['/managers', 'Managers area']] : []),
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
                    void signOut();
                  }}
                >
                  Log out
                </button>
              </li>
            )}
          </ul>
        </Sheet>
      )}
    </>
  );
}
