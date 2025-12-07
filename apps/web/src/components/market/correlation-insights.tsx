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
  correlation_type: CorrelationType;
  explanation: string;
  question: string;
};

type CorrelationData = {
  related_markets: RelatedMarket[];
  cascade_scenarios: string[];
  analyzed_at: string;
  message?: string;
};

const CORRELATION_BADGES: Record<
  CorrelationType,
  { label: string; className: string; icon: string }
> = {
  causal: {
    label: "Causal",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    icon: "→"
  },
  inverse: {
    label: "Inverse",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    icon: "↔"
  },
  leading_indicator: {
    label: "Leading",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    icon: "↗"
  },
  lagging_indicator: {
    label: "Lagging",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    icon: "↘"
  }
};

export function CorrelationInsights({ marketId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CorrelationData | null>(null);

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
      setError(err instanceof Error ? err.message : "Failed to analyze correlations");
    } finally {
      setLoading(false);
    }
  };

  const hasResults =
    data &&
    (data.related_markets.length > 0 || data.cascade_scenarios.length > 0);

  return (
    <div className="space-y-4">
      {/* Trigger Button */}
      {!data && (
        <Button
          onClick={fetchCorrelations}
          disabled={loading}
          variant="outline"
          className="w-full gap-2"
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Analyzing correlations...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Find Related Markets
            </>
          )}
        </Button>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 text-destructive">
          <svg
            className="w-5 h-5 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
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
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <div className="space-y-4">
          {/* Header with refresh */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {hasResults
                ? `Found ${data.related_markets.length} related market${data.related_markets.length !== 1 ? "s" : ""}`
                : data.message || "No correlations found"}
            </p>
            <Button
              onClick={fetchCorrelations}
              disabled={loading}
              variant="ghost"
              size="sm"
              className="gap-1.5"
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              )}
              Refresh
            </Button>
          </div>

          {/* Related Markets */}
          {data.related_markets.length > 0 && (
            <div className="space-y-3">
              {data.related_markets.map((rm) => {
                const badge = CORRELATION_BADGES[rm.correlation_type];
                return (
                  <Link
                    key={rm.market_id}
                    href={`/market/${rm.market_id}`}
                    className="block p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                          {rm.question}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {rm.explanation}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${badge.className}`}
                      >
                        <span className="mr-1">{badge.icon}</span>
                        {badge.label}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Cascade Scenarios */}
          {data.cascade_scenarios.length > 0 && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
                Cascade Scenarios
              </h4>
              <ul className="space-y-2">
                {data.cascade_scenarios.map((scenario, idx) => (
                  <li
                    key={idx}
                    className="flex gap-3 text-sm text-muted-foreground"
                  >
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed">{scenario}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamp */}
          {data.analyzed_at && (
            <p className="text-xs text-muted-foreground text-right">
              Analyzed {new Date(data.analyzed_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
