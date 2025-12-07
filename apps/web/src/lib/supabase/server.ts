import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client if env vars are present, otherwise null.
 * This avoids hard build failures when envs are missing in CI/preview.
 */
export function getSupabaseServer(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
}

