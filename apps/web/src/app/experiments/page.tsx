import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ExperimentsPanel, type Experiment } from "@/components/experiments/experiments-panel";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  const experiments: Experiment[] =
    supabase
      ? (
          await supabase
            .from("experiment_markets")
            .select("id, question, normalized_question, resolution_outcome, resolved_at, created_at")
            .order("created_at", { ascending: false })
            .limit(50)
        ).data ?? []
      : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Experiments</p>
        <h1 className="text-2xl font-semibold text-foreground">Backtest resolved questions</h1>
        <p className="text-sm text-muted-foreground">
          Create experiment markets for past events, synthesize timelines, and compare against known outcomes.
        </p>
      </div>
      <ExperimentsPanel experiments={experiments} />
    </div>
  );
}

