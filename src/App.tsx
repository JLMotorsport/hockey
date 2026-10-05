import { useCallback, useState } from 'react';
import { Splash } from './components/Splash';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminLayout } from './features/admin/AdminLayout';
import { AdminFixtureScreen, AdminFixturesScreen } from './features/admin/FixturesScreens';
import {
  AdminDeadlinesScreen,
  AdminPlayersScreen,
  AdminSettingsScreen,
  AdminSidesScreen,
  AdminUsersScreen,
} from './features/admin/ManageScreens';
import { OverviewScreen } from './features/admin/OverviewScreen';
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
  return session ? <Navigate to="/dashboard" replace /> : <HomeScreen />;
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
              <Route path="squad" element={<SquadScreen mode="pick" />} />
              <Route path="transfers" element={<SquadScreen mode="transfers" />} />
              <Route path="table" element={<TableScreen />} />
              <Route path="teams/:userId" element={<TeamScreen />} />
              <Route path="players" element={<PlayersScreen />} />
              <Route path="team-of-the-week" element={<TeamOfWeekScreen />} />
              <Route path="fixtures" element={<FixturesScreen />} />
              <Route path="rules" element={<RulesScreen />} />
              <Route path="manage" element={<AdminLayout />}>
                <Route index element={<OverviewScreen />} />
                <Route path="fixtures" element={<AdminFixturesScreen />} />
                <Route path="fixtures/:id" element={<AdminFixtureScreen />} />
                <Route path="players" element={<AdminPlayersScreen />} />
                <Route path="deadlines" element={<AdminDeadlinesScreen />} />
                <Route path="sides" element={<AdminSidesScreen />} />
                <Route path="users" element={<AdminUsersScreen />} />
                <Route path="settings" element={<AdminSettingsScreen />} />
              </Route>
              <Route path="*" element={<p className="my-6">We couldn&apos;t find that page.</p>} />
            </>
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
