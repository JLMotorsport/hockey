import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `text-[#dfe8f3] no-underline hover:text-white hover:underline ${isActive ? 'font-semibold text-white' : ''}`
      }
    >
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { session, profile } = useAuth();
  return (
    <>
      <header className="bg-[#12355b] text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="font-bold text-white no-underline hover:no-underline">
            Felixstowe HC Fantasy Hockey
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.95rem]">
            {session && <NavItem to="/dashboard">My team</NavItem>}
            {session && <NavItem to="/squad">Pick squad</NavItem>}
            <NavItem to="/table">Table</NavItem>
            <NavItem to="/players">Players</NavItem>
            <NavItem to="/fixtures">Fixtures</NavItem>
            <NavItem to="/rules">Rules</NavItem>
            {profile?.is_admin && (
              <NavLink
                to="/manage"
                className="font-semibold text-accent no-underline hover:underline"
              >
                Manage
              </NavLink>
            )}
            {session ? (
              <>
                <NavItem to="/account">Account</NavItem>
                <button
                  type="button"
                  className="text-[#dfe8f3] hover:text-white hover:underline"
                  onClick={() => void supabase?.auth.signOut()}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavItem to="/login">Log in</NavItem>
                <Link to="/register" className="btn btn-sm">
                  Join
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-10">
        <Outlet />
      </main>
      <footer className="muted mx-auto max-w-5xl px-4 pb-8 text-xs">
        Fixtures and scores from England Hockey. Player stats entered by club managers.
      </footer>
    </>
  );
}
