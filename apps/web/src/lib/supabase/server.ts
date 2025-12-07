import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase env vars are missing");
}

export const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

