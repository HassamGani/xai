export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getMarket, getMarketPosts } from "@/lib/markets";
import { OutcomeCards } from "@/components/market/outcome-cards";
import { ProbabilityChart } from "@/components/market/probability-chart";
import { PostList } from "@/components/market/post-list";

type Props = {
  params: { id: string };
};

function toSeries(
  snapshots: { timestamp: string; probabilities: Record<string, number> }[],
  outcomes: { id: string; outcome_id: string; label: string }[]
) {
  const palette = ["#2563eb", "#16a34a", "#a855f7", "#f97316", "#0ea5e9", "#e11d48", "#84cc16"];
  return outcomes.map((o, idx) => ({
    id: o.id,
    label: o.label,
    color: palette[idx % palette.length],
    data: snapshots.map((s) => {
      // Try both outcome_id and trimmed version (some data has leading spaces)
      const probs = s.probabilities ?? {};
      const value = probs[o.outcome_id] ?? probs[o.outcome_id.trim()] ?? probs[" " + o.outcome_id] ?? 0;
      return {
        time: Math.floor(new Date(s.timestamp).getTime() / 1000),
        value
      };
    })
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

  const outcomeProbs = outcomes.map((o) => {
    // Try both outcome_id and trimmed version (some data has leading spaces)
    const probs = state?.probabilities ?? {};
    const probability = probs[o.outcome_id] ?? probs[o.outcome_id.trim()] ?? probs[" " + o.outcome_id] ?? o.current_probability ?? 0;
    return {
      id: o.id,
      label: o.label,
      probability
    };
  });

  const chartSeries = toSeries(snapshots, outcomes);

  const displayPosts = posts.map((p) => ({
    id: p.scored.id,
    text: p.raw?.text,
    author_id: p.raw?.author_id,
    author_followers: p.raw?.author_followers,
    scored_at: p.scored.scored_at,
    stance_label: p.scored.display_labels?.stance_label,
    credibility_label: p.scored.display_labels?.credibility_label,
    summary: p.scored.display_labels?.summary,
    reason: p.scored.display_labels?.reason
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Created {new Date(market.created_at).toLocaleString()}
        </p>
        <h1 className="text-2xl font-semibold">{market.question}</h1>
        <p className="text-sm text-muted-foreground">
          Normalized: {market.normalized_question ?? "n/a"}
        </p>
      </div>

      <OutcomeCards outcomes={outcomeProbs} updatedAt={state?.updated_at} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Probability over time</h2>
        <ProbabilityChart series={chartSeries} />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Curated posts</h2>
        <PostList posts={displayPosts} />
      </div>
    </div>
  );
}
