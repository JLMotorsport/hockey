import { useCallback, useState } from 'react';
import { Splash } from './components/Splash';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminLayout, ManageRedirect } from './features/admin/AdminLayout';
import { GameweeksScreen } from './features/admin/GameweeksScreen';
import { IdentifyScreen } from './features/admin/IdentifyScreen';
import { MatchScreen } from './features/admin/MatchScreen';
import { MatchesScreen } from './features/admin/MatchesScreen';
import { OverviewScreen } from './features/admin/OverviewScreen';
import { PlayersScreen as ManagerPlayersScreen } from './features/admin/PlayersScreen';
import { SettingsScreen } from './features/admin/SettingsScreen';
import { UsersScreen } from './features/admin/UsersScreen';
import { AccountScreen, LoginScreen, RegisterScreen } from './features/auth/AuthScreens';
import {
  FixturesScreen,
  HomeScreen,
  PlayersScreen,
  RulesScreen,
  TableScreen,
} from './features/league/PublicScreens';
import { DashboardScreen } from './features/squad/DashboardScreen';
import { SquadScreen } from './features/squad/SquadScreen';
import { TeamScreen } from './features/squad/TeamScreen';
import { TeamOfWeekScreen } from './features/totw/TeamOfWeekScreen';
import { useAuth } from './lib/auth/AuthProvider';
import { useUiVersion } from './lib/uiVersion';
import { HomeScreen as FantasyHome } from './features/home/HomeScreen';
import { PlayersScreenV1 } from './features/v1/PlayersScreenV1';
import { SquadScreenV1 } from './features/v1/SquadScreenV1';
import { isSupabaseConfigured } from './lib/env';

function SetupScreen() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1>Almost there</h1>
      <p>
        This build has no Supabase connection. Set <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.production</code> (or{' '}
        <code>.env.local</code> for development) and rebuild. See the README.
      </p>
    </main>
  );
}

function Home() {
  const { session } = useAuth();
  const version = useUiVersion();
  if (!session) return <HomeScreen />;
  // V2: FPL's Home is where you land; V1 went straight to My Team.
  return version === 'v2' ? <FantasyHome /> : <Navigate to="/dashboard" replace />;
}

// Testing: V1 is this morning's design (6 Oct), inside the usual header and tabs.
function Squad({ mode }: { mode: 'pick' | 'transfers' }) {
  return useUiVersion() === 'v1' ? (
    <Layout>
      <SquadScreenV1 mode={mode} />
    </Layout>
  ) : (
    <SquadScreen mode={mode} />
  );
}

function Players() {
  return useUiVersion() === 'v1' ? <PlayersScreenV1 /> : <PlayersScreen />;
}

export function App() {
  const { loading } = useAuth();
  // The opening screen, once per visit: until the app is ready and the pitch is drawn.
  const [splash, setSplash] = useState(true);
  const hideSplash = useCallback(() => setSplash(false), []);
  if (!isSupabaseConfigured) return <SetupScreen />;
  return (
    <BrowserRouter>
      {splash && <Splash done={!loading} onGone={hideSplash} />}
      <Routes>
        <Route element={<Layout />}>
          {loading ? (
            <Route path="*" element={<Loading />} />
          ) : (
            <>
              <Route index element={<Home />} />
              <Route path="login" element={<LoginScreen />} />
              <Route path="register" element={<RegisterScreen />} />
              <Route path="account" element={<AccountScreen />} />
              <Route path="dashboard" element={<DashboardScreen />} />

              <Route path="table" element={<TableScreen />} />
              <Route path="teams/:userId" element={<TeamScreen />} />
              <Route path="players" element={<Players />} />
              <Route path="team-of-the-week" element={<TeamOfWeekScreen />} />
              <Route path="fixtures" element={<FixturesScreen />} />
              <Route path="rules" element={<RulesScreen />} />
              <Route path="manage/*" element={<ManageRedirect />} />
              <Route path="*" element={<p className="my-6">We couldn&apos;t find that page.</p>} />
            </>
          )}
        </Route>
        {/* Pick team and Transfers are full screens of their own, as in FPL: their own title bar, no tabs. */}
        {!loading && <Route path="squad" element={<Squad mode="pick" />} />}
        {!loading && <Route path="transfers" element={<Squad mode="transfers" />} />}
        <Route path="managers" element={<AdminLayout />}>
          <Route index element={<OverviewScreen />} />
          <Route path="matches" element={<MatchesScreen />} />
          <Route path="matches/:id" element={<MatchScreen />} />
          <Route path="players" element={<ManagerPlayersScreen />} />
          <Route path="identify" element={<IdentifyScreen />} />
          <Route path="gameweeks" element={<GameweeksScreen />} />
          <Route path="users" element={<UsersScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="fixtures/*" element={<ManageRedirect />} />
          <Route path="deadlines" element={<ManageRedirect />} />
          <Route path="sides" element={<ManageRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
