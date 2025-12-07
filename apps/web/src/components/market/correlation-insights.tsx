"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  marketId: string;
};

type CorrelationType = "causal" | "inverse" | "leading_indicator" | "lagging_indicator";

type RelatedMarket = {
  market_id: string;
  question: string;
  correlation_type: CorrelationType;
  explanation: string;
};

type CorrelationData = {
  related_markets: RelatedMarket[];
  cascade_scenarios: string[];
  generated_at: string;
  market_id: string;
  message?: string;
};

const CORRELATION_TYPE_CONFIG: Record<CorrelationType, { label: string; color: string; icon: string }> = {
  causal: {
    label: "Causal",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    icon: "→"
  },
  inverse: {
    label: "Inverse",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    icon: "↔"
  },
  leading_indicator: {
    label: "Leading",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    icon: "⟩"
  },
  lagging_indicator: {
    label: "Lagging",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    icon: "⟨"
  }
};

export function CorrelationInsights({ marketId }: Props) {
  const [data, setData] = useState<CorrelationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCorrelations = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/markets/${marketId}/correlations`);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to fetch correlations");
      }

      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Trigger Button */}
      {!data && !loading && (
        <Button
          onClick={fetchCorrelations}
          variant="outline"
          className="gap-2"
          disabled={loading}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          Find Related Markets
        </Button>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
          <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Analyzing market correlations with Grok...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-medium">Analysis failed</p>
            <p className="text-sm opacity-80 mt-1">{error}</p>
            <Button
              onClick={fetchCorrelations}
              variant="outline"
              size="sm"
              className="mt-2"
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="space-y-4">
          {/* Header with refresh */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Generated {new Date(data.generated_at).toLocaleTimeString()}
            </p>
            <Button
              onClick={fetchCorrelations}
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </Button>
          </div>

          {/* Empty state */}
          {data.related_markets.length === 0 && (
            <div className="p-4 rounded-lg border border-border bg-card text-center">
              <p className="text-sm text-muted-foreground">
                {data.message || "No correlated markets found"}
              </p>
            </div>
          )}

          {/* Related Markets Grid */}
          {data.related_markets.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.related_markets.map((rm) => {
                const config = CORRELATION_TYPE_CONFIG[rm.correlation_type];
                return (
                  <Link
                    key={rm.market_id}
                    href={`/market/${rm.market_id}`}
                    className="group block"
                  >
                    <div className="p-4 rounded-lg border border-border bg-card hover:border-primary/30 hover:bg-accent/50 transition-colors h-full">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium ${config.color}`}
                        >
                          {config.icon} {config.label}
                        </Badge>
                      </div>
                      <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-2">
                        {rm.question}
                      </h4>
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {rm.explanation}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Cascade Scenarios */}
          {data.cascade_scenarios.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Cascade Scenarios
              </h4>
              <ul className="space-y-2">
                {data.cascade_scenarios.map((scenario, idx) => (
                  <li
                    key={idx}
                    className="flex gap-3 text-sm text-muted-foreground p-3 rounded-lg border border-border bg-card"
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{scenario}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
