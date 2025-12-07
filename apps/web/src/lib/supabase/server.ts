import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client if env vars are present, otherwise null.
 * Accepts both NEXT_PUBLIC_* (preferred) and plain SUPABASE_* fallbacks.
 */
export function getSupabaseServer(): SupabaseClient | null {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
}

