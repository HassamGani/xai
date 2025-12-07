import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = paramsSchema.parse(params);
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { data: exp, error: expErr } = await supabase
    .from("experiment_markets")
    .select("*")
    .eq("id", id)
    .single();
  if (expErr || !exp) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

  const { data: runs } = await supabase
    .from("experiment_runs")
    .select("*")
    .eq("experiment_id", id)
    .order("started_at", { ascending: false })
    .limit(1);

  const { data: snapshots } = await supabase
    .from("experiment_snapshots")
    .select("*")
    .eq("experiment_id", id)
    .order("timestamp", { ascending: true });

  return NextResponse.json({
    experiment: exp,
    last_run: runs?.[0] || null,
    snapshots: snapshots || []
  });
}

