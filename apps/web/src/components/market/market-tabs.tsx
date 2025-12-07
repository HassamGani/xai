"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LivePanel } from "@/components/market/live-panel";
import { GrokAnalysis } from "@/components/market/grok-analysis";
import { CorrelationInsights } from "@/components/market/correlation-insights";
import { PostList } from "@/components/market/post-list";
import { DeleteMarketButton } from "@/components/market/delete-market-button";
import { AddTickerForm } from "@/components/market/add-ticker-form";
import { RemoveTickerButton } from "@/components/market/remove-ticker-button";

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

type Post = {
  id: string;
  x_post_id?: string | null;
  text?: string | null;
  author_id?: string | null;
  author_username?: string | null;
  author_followers?: number | null;
  scored_at: string;
  stance_label?: string;
  credibility_label?: string;
  summary?: string;
  reason?: string;
  relevance_score?: number;
};

type Props = {
  marketId: string;
  outcomes: Outcome[];
  state: MarketState | null;
  snapshots: Snapshot[];
  winningOutcomeId?: string;
  posts: Post[];
  showDevControls: boolean;
};

export function MarketTabs({
  marketId,
  outcomes,
  state,
  snapshots,
  winningOutcomeId,
  posts,
  showDevControls,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Probabilities and Chart - Always visible */}
      <LivePanel
        marketId={marketId}
        outcomes={outcomes}
        state={state}
        snapshots={snapshots}
        winningOutcomeId={winningOutcomeId}
      />

      {/* Tabs for other content */}
      <Tabs defaultValue="analysis" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="analysis">AI Analysis</TabsTrigger>
          <TabsTrigger value="correlations">Correlations</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          {showDevControls && (
            <TabsTrigger value="dev" className="text-destructive data-[state=active]:text-destructive">
              Dev Tools
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="analysis" className="mt-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">AI Analysis</h2>
            <p className="text-sm text-muted-foreground">
              Get AI-powered analysis of this market using Grok with web search.
            </p>
            <GrokAnalysis marketId={marketId} />
          </div>
        </TabsContent>

        <TabsContent value="correlations" className="mt-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Cross-Market Correlations</h2>
            <p className="text-sm text-muted-foreground">
              Discover markets with correlated probability movements and causality chains.
            </p>
            <CorrelationInsights marketId={marketId} />
          </div>
        </TabsContent>

        <TabsContent value="posts" className="mt-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Curated Posts</h2>
            <PostList posts={posts} marketId={marketId} />
          </div>
        </TabsContent>

        {showDevControls && (
          <TabsContent value="dev" className="mt-6">
            <div className="border border-destructive/30 rounded-lg p-4 space-y-4">
              <p className="text-sm font-medium text-destructive">Developer-only controls</p>
              
              <div className="space-y-2">
                <p className="text-sm font-medium">Delete Market</p>
                <DeleteMarketButton marketId={marketId} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Add ticker</p>
                <AddTickerForm
                  marketId={marketId}
                  existingLabels={outcomes.map((o) => o.label)}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Remove ticker</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {outcomes.map((o) => (
                    <RemoveTickerButton
                      key={o.id}
                      marketId={marketId}
                      outcomeId={o.outcome_id}
                      label={o.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
