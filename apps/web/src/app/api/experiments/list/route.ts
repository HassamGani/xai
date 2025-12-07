import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { data: experiments, error } = await supabase
    .from("experiment_markets")
    .select("id, question, normalized_question, resolution_outcome, resolved_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: "Failed to fetch experiments" }, { status: 500 });

  const ids = experiments?.map((e: any) => e.id) ?? [];
  let runsByExp: Record<string, any> = {};

  if (ids.length > 0) {
    const { data: runs } = await supabase
      .from("experiment_runs")
      .select("id, experiment_id, status, started_at, finished_at, error")
      .in("experiment_id", ids)
      .order("started_at", { ascending: false });

    if (runs) {
      for (const run of runs) {
        if (!runsByExp[run.experiment_id]) runsByExp[run.experiment_id] = run;
      }
    }
  }

  const enriched = (experiments || []).map((e: any) => ({
    ...e,
    last_run: runsByExp[e.id] || null
  }));

  return NextResponse.json({ experiments: enriched });
}

