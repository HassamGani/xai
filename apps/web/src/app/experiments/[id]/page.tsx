import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ExperimentDetailClient } from "@/components/experiments/experiment-detail-client";

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

  const lastRun = runs?.[0] || null;

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
      <ExperimentDetailClient experiment={exp} lastRun={lastRun} snapshots={snapshots || []} />
    </div>
  );
}

