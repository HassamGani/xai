import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) return json({ error: "Database not configured" }, 503);

  // Fetch outcomes, state, snapshots
  const [outcomesRes, stateRes, snapsRes] = await Promise.all([
    supabase.from("outcomes").select("*").eq("market_id", marketId).order("label", { ascending: true }),
    supabase.from("market_state").select("*").eq("market_id", marketId).single(),
    supabase
      .from("probability_snapshots")
      .select("*")
      .eq("market_id", marketId)
      .order("timestamp", { ascending: true })
      .limit(400)
  ]);

  if (outcomesRes.error) return json({ error: "Failed to load outcomes" }, 500);
  if (stateRes.error && stateRes.status !== 406) return json({ error: "Failed to load market state" }, 500);
  if (snapsRes.error) return json({ error: "Failed to load snapshots" }, 500);

  return json({
    outcomes: outcomesRes.data ?? [],
    state: stateRes.data ?? null,
    snapshots: snapsRes.data ?? []
  });
}

