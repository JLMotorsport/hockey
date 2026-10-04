import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, profile: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(supabase));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Squads, admin pages etc. depend on who is logged in.
      void queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: ['profile', userId ?? ''],
    enabled: Boolean(supabase && userId),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('profiles')
        .select('*')
        .eq('id', userId as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const value: AuthState = {
    session,
    profile: profileQuery.data ?? null,
    loading: sessionLoading || (Boolean(userId) && profileQuery.isLoading),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
