"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Outcome = {
  id: string;
  label: string;
  probability: number;
};

type Market = {
  id: string;
  question: string;
  normalized_question: string | null;
  created_at: string;
  total_posts_processed: number | null;
  posts_count?: number | null;
  outcomes: Outcome[];
};

type Props = {
  markets: Market[];
};

export function MarketList({ markets }: Props) {
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const filtered = markets.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.question.toLowerCase().includes(q) ||
      (m.normalized_question?.toLowerCase().includes(q) ?? false)
    );
  });

  const handleCreateMarket = async () => {
    if (!search.trim() || search.trim().length < 10) {
      setError("Please enter a more detailed question (at least 10 characters)");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/markets/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: search.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to create market");
        return;
      }

      startTransition(() => {
        router.push(`/market/${data.marketId}`);
        router.refresh();
      });
    } catch (err) {
      setError("Network error. Please try again.");
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  const showCreateOption = search.trim().length >= 10 && filtered.length === 0;

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setError(null);
          }}
          placeholder="Search markets or ask a new question..."
          className="w-full h-11 rounded-lg border border-input bg-background px-4 pl-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && showCreateOption && !isCreating) {
              handleCreateMarket();
            }
          }}
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {search && (
          <button
            onClick={() => {
              setSearch("");
              setError(null);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results count */}
      {search && !showCreateOption && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} market{filtered.length !== 1 ? "s" : ""} found
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Markets grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((m) => {
          const hasProbs = m.outcomes.length > 0 && m.outcomes.some(o => o.probability > 0);
          const leadingOutcome = m.outcomes[0]; // Already sorted by probability desc
          
          return (
            <Link key={m.id} href={`/market/${m.id}`} className="group">
              <Card className="h-full transition-colors hover:bg-accent/50 relative overflow-hidden">
                {/* Background probability bar for leading outcome */}
                {hasProbs && leadingOutcome && (
                  <div
                    className="absolute inset-0 bg-primary/5"
                    style={{ width: `${Math.max(leadingOutcome.probability * 100, 5)}%` }}
                  />
                )}
                <CardHeader className="relative pb-2">
                  <CardTitle className="line-clamp-2 group-hover:text-primary transition-colors">
                    {m.question}
                  </CardTitle>
                  <CardDescription>
                    {new Date(m.created_at).toLocaleDateString()} · {(m.posts_count ?? m.total_posts_processed ?? 0)} posts
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative pt-0">
                  {hasProbs ? (
                    <div className="flex flex-wrap gap-2">
                      {m.outcomes.slice(0, 3).map((o, idx) => (
                        <div
                          key={o.id}
                          className={`flex items-center gap-1.5 text-sm ${
                            idx === 0
                              ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                              : idx === 1
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="truncate max-w-[100px]">{o.label}</span>
                          <span className="font-mono tabular-nums">
                            {(o.probability * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                      {m.outcomes.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{m.outcomes.length - 3} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Awaiting posts...
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Create market prompt */}
      {filtered.length === 0 && (
        <Card className="p-6 text-center">
          {search.trim().length < 10 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {search ? `No markets matching "${search}"` : "No markets found."}
              </p>
              <p className="text-sm text-muted-foreground">
                Enter a detailed question (10+ chars) to create a new market
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-medium">No existing market found</p>
              <p className="text-muted-foreground">
                Create a prediction market for:
              </p>
              <p className="font-medium text-primary">"{search}"</p>
              <Button
                onClick={handleCreateMarket}
                disabled={isCreating || isPending}
              >
                {isCreating || isPending ? "Creating..." : "Create Market"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Press Enter to create
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
