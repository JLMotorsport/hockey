import type { ReactNode } from 'react';
import { Outlet, Route, Routes } from 'react-router-dom';
import { Loading } from '@/components/ui';
import { AccountScreen, LoginScreen, RegisterScreen } from '@/features/auth/AuthScreens';
import { HomeScreen as PublicHome } from '@/features/league/PublicScreens';
import { TeamOfWeekScreen } from '@/features/totw/TeamOfWeekScreen';
import { useAuth } from '@/lib/auth/AuthProvider';
import { V3Fixtures } from './V3Fixtures';
import { V3Home } from './V3Home';
import { V3League } from './V3League';
import { V3More } from './V3More';
import { V3Players } from './V3Players';
import { V3Points } from './V3Points';
import { V3Rules } from './V3Rules';
import { V3Squad } from './V3Squad';
import { V3Fallback, V3Shell } from './V3Shell';

// V3. Every player-facing screen has its V3 design; Join, Account and the
// public home page show their V2 version inside the V3 frame, and the
// managers' area keeps its layout in the V3 colours.

function Home() {
  const { session } = useAuth();
  return session ? (
    <V3Home />
  ) : (
    <V3Fallback>
      <PublicHome />
    </V3Fallback>
  );
}

const fallback = (node: ReactNode) => (
  <V3Shell>
    <V3Fallback>{node}</V3Fallback>
  </V3Shell>
);

const v3 = (node: ReactNode) => <V3Shell>{node}</V3Shell>;

export function V3Routes({ loading, managers }: { loading: boolean; managers: ReactNode }) {
  if (loading) {
    return (
      <V3Shell dock={false}>
        <Loading />
      </V3Shell>
    );
  }
  return (
    <Routes>
      <Route
        index
        element={
          <V3Shell>
            <Home />
          </V3Shell>
        }
      />
      <Route
        path="squad"
        element={
          <V3Shell dock={false}>
            <V3Squad mode="pick" />
          </V3Shell>
        }
      />
      <Route
        path="transfers"
        element={
          <V3Shell dock={false}>
            <V3Squad mode="transfers" />
          </V3Shell>
        }
      />
      <Route
        path="login"
        element={
          <V3Shell dock={false}>
            <LoginScreen v3 />
          </V3Shell>
        }
      />
      <Route path="register" element={fallback(<RegisterScreen />)} />
      <Route path="account" element={fallback(<AccountScreen />)} />
      <Route path="dashboard" element={v3(<V3Points />)} />
      <Route path="table" element={v3(<V3League />)} />
      <Route path="teams/:userId" element={v3(<V3Points />)} />
      <Route path="more" element={v3(<V3More />)} />
      <Route path="players" element={v3(<V3Players />)} />
      <Route path="team-of-the-week" element={v3(<TeamOfWeekScreen v3 />)} />
      <Route path="fixtures" element={v3(<V3Fixtures />)} />
      <Route path="rules" element={v3(<V3Rules />)} />
      {/* The managers' area keeps its own layout, in the V3 colours. */}
      <Route
        element={
          <V3Shell dock={false}>
            <Outlet />
          </V3Shell>
        }
      >
        {managers}
      </Route>
      <Route
        path="*"
        element={fallback(<p className="my-6">We couldn&apos;t find that page.</p>)}
      />
    </Routes>
  );
}
