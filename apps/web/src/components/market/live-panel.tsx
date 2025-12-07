"use client";

import { useEffect, useMemo, useState } from "react";
import { OutcomeCards } from "@/components/market/outcome-cards";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { Button } from "@/components/ui/button";

type Outcome = {
  id: string;
  outcome_id: string;
  label: string;
  current_probability: number | null;
};

type Snapshot = {
  timestamp: string;
  probabilities: Record<string, number>;
};

type MarketState = {
  market_id: string;
  probabilities: Record<string, number>;
  updated_at?: string;
};

type Props = {
  marketId: string;
  outcomes: Outcome[];
  state: MarketState | null;
  snapshots: Snapshot[];
  winningOutcomeId?: string;
};

function findProb(probs: Record<string, number> | null | undefined, outcomeId: string): number {
  if (!probs) return 0;
  if (outcomeId in probs) return probs[outcomeId];
  const trimmed = outcomeId.trim();
  if (trimmed in probs) return probs[trimmed];
  const withSpace = " " + trimmed;
  if (withSpace in probs) return probs[withSpace];
  for (const key of Object.keys(probs)) {
    if (key.trim().toLowerCase() === trimmed.toLowerCase()) {
      return probs[key];
    }
  }
  return 0;
}

export function LivePanel({ marketId, outcomes, state, snapshots, winningOutcomeId }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ outcomes, state, snapshots });
  const [error, setError] = useState<string | null>(null);

  // Outcomes with probabilities
  const outcomeProbs = useMemo(() => {
    return (data.outcomes ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      probability: findProb(data.state?.probabilities, o.outcome_id) || o.current_probability || 0
    }));
  }, [data.outcomes, data.state]);

  // Chart series
  const chartSeries = useMemo(() => {
    const palette = ["#2563eb", "#16a34a", "#a855f7", "#f97316", "#0ea5e9", "#e11d48", "#84cc16"];
    return (data.outcomes ?? []).map((o, idx) => ({
      id: o.id,
      label: o.label,
      color: palette[idx % palette.length],
      data: (data.snapshots ?? []).map((s) => ({
        time: Math.floor(new Date(s.timestamp).getTime() / 1000),
        value: findProb(s.probabilities, o.outcome_id)
      }))
    }));
  }, [data.outcomes, data.snapshots]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets/${marketId}/state?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "x-no-cache": Date.now().toString() },
        next: { revalidate: 0 }
      });
      if (!res.ok) {
        setError("Failed to refresh");
        return;
      }
      const json = await res.json();
      setData({
        outcomes: json.outcomes ?? [],
        state: json.state ?? null,
        snapshots: json.snapshots ?? []
      });
    } finally {
      setLoading(false);
    }
  };

  // Light auto-refresh every 45s
  useEffect(() => {
    const id = setInterval(() => {
      handleRefresh();
    }, 45000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Probabilities</h2>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
        {(() => {
          const times: string[] = [];
          if (data.state?.updated_at) times.push(data.state.updated_at as string);
          const lastSnap = data.snapshots?.[data.snapshots.length - 1]?.timestamp as string | undefined;
          if (lastSnap) times.push(lastSnap);
          if (times.length === 0) return null;
          const latest = times.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a), times[0]);
          return (
            <span className="text-xs text-muted-foreground">
              Last updated {new Date(latest).toLocaleString()}
            </span>
          );
        })()}
      </div>
      <p className="text-xs text-muted-foreground">
        Snapshots: {data.snapshots?.length ?? 0}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <OutcomeCards
        outcomes={outcomeProbs}
        updatedAt={(data.state?.updated_at as string) || (data.snapshots?.at?.(-1)?.timestamp as string)}
        winningOutcomeId={winningOutcomeId}
      />
      <div className="space-y-3">
        <h3 className="text-md font-medium">Probability over time</h3>
        <ProbabilityChart series={chartSeries} />
      </div>
    </div>
  );
}

