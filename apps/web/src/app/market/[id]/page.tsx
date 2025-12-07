export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { getMarket, getMarketPosts } from "@/lib/markets";
import { OutcomeCards } from "@/components/market/outcome-cards";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { PostList } from "@/components/market/post-list";
import { ResolutionBanner } from "@/components/market/resolution-banner";
import { MarketInfo } from "@/components/market/market-info";
import { GrokAnalysis } from "@/components/market/grok-analysis";
import { CorrelationInsights } from "@/components/market/correlation-insights";
import { Button } from "@/components/ui/button";

type Props = {
  params: { id: string };
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

function toSeries(
  snapshots: { timestamp: string; probabilities: Record<string, number> }[],
  outcomes: { id: string; outcome_id: string; label: string }[]
) {
  const palette = ["#2563eb", "#16a34a", "#a855f7", "#f97316", "#0ea5e9", "#e11d48", "#84cc16"];
  return outcomes.map((o, idx) => ({
    id: o.id,
    label: o.label,
    color: palette[idx % palette.length],
    data: snapshots.map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000),
      value: findProb(s.probabilities, o.outcome_id)
    }))
  }));
}

export default async function MarketPage({ params }: Props) {
  const marketId = params.id;
  const { market, outcomes, state, snapshots } = await getMarket(marketId).catch(() => ({
    market: null,
    outcomes: [],
    state: null,
    snapshots: []
  }));

  if (!market) return notFound();

  const posts = await getMarketPosts(marketId, 25);

  const outcomeProbs = outcomes.map((o) => ({
    id: o.id,
    label: o.label,
    probability: findProb(state?.probabilities, o.outcome_id) || o.current_probability || 0
  }));

  const chartSeries = toSeries(snapshots, outcomes);

  const displayPosts = posts.map((p) => ({
    id: p.scored.id,
    x_post_id: p.raw?.x_post_id,
    text: p.raw?.text,
    author_id: p.raw?.author_id,
    author_followers: p.raw?.author_followers,
    scored_at: p.scored.scored_at,
    stance_label: p.scored.display_labels?.stance_label,
    credibility_label: p.scored.display_labels?.credibility_label,
    summary: p.scored.display_labels?.summary,
    reason: p.scored.display_labels?.reason,
    relevance_score: (p.scored.scores as { relevance?: number } | null)?.relevance ?? 0
  }));

  // Find winning outcome label if resolved
  const winningOutcome = market.resolved_outcome_id 
    ? outcomes.find((o) => o.id === market.resolved_outcome_id)
    : null;

  const isResolved = !!market.resolved_at;

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="pl-0 text-muted-foreground hover:text-foreground">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Markets
          </Button>
        </Link>
      </div>

      {/* Resolution Banner (if resolved) */}
      {isResolved && winningOutcome && market.resolved_at && (
        <ResolutionBanner
          winningOutcome={winningOutcome.label}
          resolvedAt={market.resolved_at}
          resolutionSummary={market.resolution_summary}
          resolutionSource={market.resolution_source}
        />
      )}

      {/* Market Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Created {new Date(market.created_at).toLocaleDateString()}</span>
          {isResolved && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              Resolved
            </span>
          )}
          {!isResolved && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
              Active
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold">{market.question}</h1>
      </div>

      {/* Market Info Card (resolution date, criteria) */}
      <MarketInfo
        normalizedQuestion={market.normalized_question}
        estimatedResolutionDate={market.estimated_resolution_date}
        resolutionCriteria={market.resolution_criteria}
        totalPostsProcessed={market.total_posts_processed ?? undefined}
        isResolved={isResolved}
      />

      <OutcomeCards 
        outcomes={outcomeProbs} 
        updatedAt={state?.updated_at}
        winningOutcomeId={winningOutcome?.id}
      />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Probability over time</h2>
        <ProbabilityChart series={chartSeries} />
      </div>

      {/* Grok Analysis */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">AI Analysis</h2>
        <GrokAnalysis marketId={marketId} />
      </div>

      {/* Cross-Market Correlations */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Related Markets</h2>
        <CorrelationInsights marketId={marketId} />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Curated posts</h2>
        <PostList posts={displayPosts} />
      </div>
    </div>
  );
}
