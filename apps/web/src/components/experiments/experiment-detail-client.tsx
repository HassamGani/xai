"use client";

import { useEffect, useState } from "react";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { RunExperimentButton } from "@/components/experiments/run-experiment-button";

type Snapshot = {
  timestamp: string;
  probabilities: Record<string, number>;
};

type Experiment = {
  id: string;
  question: string;
  normalized_question: string | null;
  outcomes: Array<{ label: string }>;
  resolution_outcome: string | null;
  resolved_at: string | null;
};

type RunInfo = {
  status: string;
  started_at: string;
  finished_at: string | null;
  error?: string | null;
};

type Props = {
  experiment: Experiment;
  lastRun: RunInfo | null;
  snapshots: Snapshot[];
};

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#a855f7",
  "#f97316",
  "#0ea5e9",
  "#e11d48",
  "#84cc16"
];

export function ExperimentDetailClient({ experiment, lastRun, snapshots: initial }: Props) {
  const [snapshots, setSnapshots] = useState(initial);
  const [runInfo, setRunInfo] = useState(lastRun);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${experiment.id}/detail`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Failed to load");
      setSnapshots(data.snapshots || []);
      setRunInfo(data.last_run || null);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If running, poll a few times to update status/snapshots
    if (runInfo?.status === "running") {
      const interval = setInterval(fetchDetail, 3000);
      return () => clearInterval(interval);
    }
  }, [runInfo]);

  const outcomeLabels = (experiment.outcomes || []).map((o) => o.label);
  const series = outcomeLabels.map((label, idx) => ({
    id: label,
    label,
    color: CHART_COLORS[idx % CHART_COLORS.length],
    data: (snapshots || []).map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000),
      value: (s.probabilities as Record<string, number>)[label] ?? 0
    }))
  }));

  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Probability timeline</h3>
        <RunExperimentButton experimentId={experiment.id} onFinished={fetchDetail} />
      </div>
      {error && <p className="text-xs text-destructive mb-2">{error}</p>}
      {runInfo && (
        <p className="text-[11px] text-muted-foreground mb-2">
          Status: {runInfo.status}
          {runInfo.started_at ? ` • Started ${new Date(runInfo.started_at).toLocaleString()}` : ""}
          {runInfo.finished_at ? ` • Finished ${new Date(runInfo.finished_at).toLocaleString()}` : ""}
          {runInfo.error ? ` • Error: ${runInfo.error}` : ""}
        </p>
      )}
      {loading && <p className="text-xs text-muted-foreground mb-2">Loading...</p>}
      {series.every((s) => s.data.length === 0) ? (
        <p className="text-sm text-muted-foreground">No snapshots yet. Run the experiment to generate.</p>
      ) : (
        <ProbabilityChart series={series} height={320} />
      )}
    </div>
  );
}

