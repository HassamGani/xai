"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Market = {
  id: string;
  question: string;
  normalized_question: string | null;
  created_at: string;
  total_posts_processed: number | null;
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

      // Navigate to the market (whether existing or new)
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
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 pl-11 text-sm placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 backdrop-blur-sm transition"
          onKeyDown={(e) => {
            if (e.key === "Enter" && showCreateOption && !isCreating) {
              handleCreateMarket();
            }
          }}
        />
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
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
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results count or create prompt */}
      {search && !showCreateOption && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} market{filtered.length !== 1 ? "s" : ""} found
        </p>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Market grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((m) => (
          <Link key={m.id} href={`/market/${m.id}`} className="group">
            <Card className="h-full transition hover:border-primary/60 hover:bg-white/10">
              <CardHeader>
                <CardTitle className="line-clamp-2">{m.question}</CardTitle>
                <CardDescription>
                  Created {new Date(m.created_at).toLocaleString()} • Posts{" "}
                  {m.total_posts_processed ?? 0}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-1">
                  Normalized: {m.normalized_question ?? "n/a"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* No results - Create market prompt */}
      {filtered.length === 0 && (
        <div className="glass-strong rounded-2xl border border-white/15 px-6 py-8 text-center space-y-4">
          {search.trim().length < 10 ? (
            <>
              <div className="text-4xl">🔮</div>
              <p className="text-muted-foreground">
                {search ? `No markets matching "${search}"` : "No markets found."}
              </p>
              <p className="text-sm text-muted-foreground">
                Enter a detailed question (10+ characters) to create a new prediction market
              </p>
            </>
          ) : (
            <>
              <div className="text-4xl">🎯</div>
              <p className="text-lg font-medium">No existing market found</p>
              <p className="text-muted-foreground max-w-md mx-auto">
                Would you like to create a prediction market for:
              </p>
              <p className="text-lg font-medium text-blue-400">"{search}"</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Grok AI will analyze your question, generate outcomes, and set up X stream rules to track relevant posts.
              </p>
              <Button
                onClick={handleCreateMarket}
                disabled={isCreating || isPending}
                className="mt-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {isCreating || isPending ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Creating Market...
                  </>
                ) : (
                  <>
                    <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Prediction Market
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs">Enter</kbd> to create
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
