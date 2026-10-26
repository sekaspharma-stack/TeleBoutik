import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Keep one client instance for the entire application. The harmless fallback
// prevents startup crashes when cloud credentials are absent; syncEngine checks
// isSupabaseConfigured before attempting any cloud operation.
const fallbackUrl = 'http://127.0.0.1:54321';
const fallbackKey = 'supabase-not-configured';

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase env vars missing — cloud sync disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || fallbackUrl,
  supabaseAnonKey || fallbackKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
