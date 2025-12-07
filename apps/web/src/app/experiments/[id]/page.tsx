import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { RunExperimentButton } from "@/components/experiments/run-experiment-button";

export const dynamic = "force-dynamic";

type Experiment = {
  id: string;
  question: string;
  normalized_question: string | null;
  outcomes: Array<{ label: string }>;
  resolution_outcome: string | null;
  resolved_at: string | null;
  created_at: string;
};

export default async function ExperimentPage({ params }: { params: { id: string } }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return notFound();

  const { data: exp, error } = await supabase
    .from("experiment_markets")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !exp) return notFound();

  const { data: runs } = await supabase
    .from("experiment_runs")
    .select("*")
    .eq("experiment_id", params.id)
    .order("started_at", { ascending: false })
    .limit(1);

  const { data: snapshots } = await supabase
    .from("experiment_snapshots")
    .select("*")
    .eq("experiment_id", params.id)
    .order("timestamp", { ascending: true });

  const outcomes = (exp.outcomes || []) as Array<{ label: string }>;
  const outcomeLabels = outcomes.map((o) => o.label);

  // Build chart series from snapshots
  const series = outcomeLabels.map((label, idx) => ({
    id: label,
    label,
    color: CHART_COLORS[idx % CHART_COLORS.length],
    data: (snapshots || []).map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000),
      value: (s.probabilities as Record<string, number>)[label] ?? 0
    }))
  }));

  const lastRun = runs?.[0];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Experiment</p>
        <h1 className="text-2xl font-semibold text-foreground">{exp.question}</h1>
        {exp.normalized_question && (
          <p className="text-sm text-muted-foreground">{exp.normalized_question}</p>
        )}
        <p className="text-sm text-muted-foreground">
          Resolved outcome (inferred): {exp.resolution_outcome || "—"} • Resolved at:{" "}
          {exp.resolved_at ? new Date(exp.resolved_at).toLocaleString() : "—"}
        </p>
        {lastRun && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Last run: {lastRun.status} • Started {new Date(lastRun.started_at).toLocaleString()}
              {lastRun.finished_at ? ` • Finished ${new Date(lastRun.finished_at).toLocaleString()}` : ""}
            </p>
            {lastRun.error && (
              <p className="text-destructive">Error: {lastRun.error}</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Probability timeline</h3>
          <RunExperimentButton experimentId={exp.id} />
        </div>
        {series.every((s) => s.data.length === 0) ? (
          <p className="text-sm text-muted-foreground">No snapshots yet. Run the experiment to generate.</p>
        ) : (
          <ProbabilityChart series={series} height={320} />
        )}
      </div>
    </div>
  );
}

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#a855f7",
  "#f97316",
  "#0ea5e9",
  "#e11d48",
  "#84cc16"
];

