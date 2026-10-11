import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loading } from '@/components/ui';
import { AccountScreen, LoginScreen, RegisterScreen } from '@/features/auth/AuthScreens';
import {
  FixturesScreen,
  HomeScreen as PublicHome,
  PlayersScreen,
  RulesScreen,
  TableScreen,
} from '@/features/league/PublicScreens';
import { DashboardScreen } from '@/features/squad/DashboardScreen';
import { SquadScreen } from '@/features/squad/SquadScreen';
import { TeamScreen } from '@/features/squad/TeamScreen';
import { TeamOfWeekScreen } from '@/features/totw/TeamOfWeekScreen';
import { useAuth } from '@/lib/auth/AuthProvider';
import { V3Home } from './V3Home';
import { V3Fallback, V3Shell } from './V3Shell';

// V3 (being built). Screens already rebuilt use the V3 design; the rest show
// their V2 version inside the V3 frame until their turn comes.

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
            <SquadScreen mode="pick" />
          </V3Shell>
        }
      />
      <Route
        path="transfers"
        element={
          <V3Shell dock={false}>
            <SquadScreen mode="transfers" />
          </V3Shell>
        }
      />
      <Route path="login" element={fallback(<LoginScreen />)} />
      <Route path="register" element={fallback(<RegisterScreen />)} />
      <Route path="account" element={fallback(<AccountScreen />)} />
      <Route path="dashboard" element={fallback(<DashboardScreen />)} />
      <Route path="table" element={fallback(<TableScreen />)} />
      <Route path="teams/:userId" element={fallback(<TeamScreen />)} />
      <Route path="players" element={fallback(<PlayersScreen />)} />
      <Route path="team-of-the-week" element={fallback(<TeamOfWeekScreen />)} />
      <Route path="fixtures" element={fallback(<FixturesScreen />)} />
      <Route path="rules" element={fallback(<RulesScreen />)} />
      {managers}
      <Route
        path="*"
        element={fallback(<p className="my-6">We couldn&apos;t find that page.</p>)}
      />
    </Routes>
  );
}
