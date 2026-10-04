import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env';
import type { Database } from '@/types/database';

export type DbClient = SupabaseClient<Database>;

// Single Supabase client for the app. The anon key is safe in the bundle
// because row-level security is the real boundary. When env isn't configured
// the client is null and the UI shows a setup screen instead of crashing.
let client: DbClient | null = null;

if (isSupabaseConfigured) {
  client = createClient<Database>(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // The default cross-tab lock (navigator.locks) can stay held after a
      // phone suspends the tab, leaving every request waiting for good. An
      // in-page lock can't get stuck that way.
      lock: processLock,
    },
  });
}

export const supabase = client;

/** Narrowing accessor for code paths that require a configured client. */
export function requireSupabase(): DbClient {
  if (!client) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  return client;
}

/**
 * Database functions raise one exception with one problem per line (see
 * save_squad). Split them back out for display.
 */
export function errorLines(error: unknown): string[] {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : 'Something went wrong. Try again.';
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
