export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { listMarkets } from "@/lib/markets";
import { MarketList } from "@/components/market/market-list";
import { QaPanel } from "@/components/qa/qa-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function HomePage() {
  // Force fresh data on every request
  const markets = await listMarkets();
  const supabaseMissing = markets.length === 0;

  const totalMarkets = markets.length;
  const resolvedMarkets = markets.filter((m) => m.resolved_at).length;
  const totalPosts = markets.reduce(
    (sum, m) => sum + (m.posts_count ?? m.total_posts_processed ?? 0),
    0
  );

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="rounded-2xl border border-border bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">
              xPredict
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">
              Real-time prediction tickers from X + Grok
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Ask a question, Grok normalizes it, streams X, scores posts, and updates probabilities continuously.
              Browse live markets or spin up a new one instantly.
            </p>
          </div>
          <div className="flex gap-3">
            <a
              href="#markets"
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow hover:shadow-md transition-shadow"
            >
              View live markets
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
            <a
              href="#markets"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Create a market
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          <div className="rounded-xl border border-border bg-card/70 p-4">
            <p className="text-xs text-muted-foreground">Live markets</p>
            <p className="text-2xl font-semibold text-foreground">{totalMarkets}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/70 p-4">
            <p className="text-xs text-muted-foreground">Resolved</p>
            <p className="text-2xl font-semibold text-foreground">{resolvedMarkets}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/70 p-4">
            <p className="text-xs text-muted-foreground">Posts analyzed</p>
            <p className="text-2xl font-semibold text-foreground">
              {totalPosts.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="markets" className="space-y-4">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="markets">Markets</TabsTrigger>
          <TabsTrigger value="ask">Ask Grok</TabsTrigger>
        </TabsList>

        <TabsContent value="markets" className="space-y-3" id="markets">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Markets</h2>
            <p className="text-sm text-muted-foreground">
              Probabilities derived from X posts scored by Grok
            </p>
            {supabaseMissing && (
              <p className="text-xs text-destructive">
                Database not configured or no markets found
              </p>
            )}
          </div>
          <MarketList markets={markets} />
        </TabsContent>

        <TabsContent value="ask" className="space-y-3">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Ask Grok about the markets</h2>
            <p className="text-sm text-muted-foreground">
              Natural language queries for movers, drivers, and correlations.
            </p>
          </div>
          <QaPanel compact />
        </TabsContent>
      </Tabs>

      {/* Footer Credits */}
      <footer className="border-t border-border pt-6 pb-4 text-center">
        <p className="text-sm text-muted-foreground">
          Made by{" "}
          <span className="font-medium text-foreground">Hassam Gani</span>
          {" & "}
          <span className="font-medium text-foreground">Farhaan Siddiqui</span>
        </p>
      </footer>
    </div>
  );
}
