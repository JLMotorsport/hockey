import { z } from 'zod';

// Missing Supabase config is a recoverable state (we render a setup screen)
// rather than a crash, so the vars are validated leniently here.
const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  VITE_SUPABASE_ANON_KEY: z.string().optional(),
});

const parsed = envSchema.parse(import.meta.env);

export const env = {
  supabaseUrl: parsed.VITE_SUPABASE_URL || undefined,
  supabaseAnonKey: parsed.VITE_SUPABASE_ANON_KEY || undefined,
} as const;

/** True only when both required Supabase vars are present. */
export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
