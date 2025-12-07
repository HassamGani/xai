import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client with anon key for read operations.
 * Accepts both NEXT_PUBLIC_* (preferred) and plain SUPABASE_* fallbacks.
 */
export function getSupabaseServer(): SupabaseClient | null {
  const supabaseUrlRaw =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? undefined;
  const supabaseAnonKeyRaw =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? undefined;

  const supabaseUrl = supabaseUrlRaw ? supabaseUrlRaw.trim() : undefined;
  const supabaseAnonKey = supabaseAnonKeyRaw ? supabaseAnonKeyRaw.trim() : undefined;

  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
}

/**
 * Returns a Supabase client with service role key for write operations.
 * This bypasses RLS and should only be used in server-side API routes.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrlRaw =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? undefined;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabaseUrl = supabaseUrlRaw ? supabaseUrlRaw.trim() : undefined;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

