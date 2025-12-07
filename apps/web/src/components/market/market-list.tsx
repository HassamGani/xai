"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  const filtered = markets.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.question.toLowerCase().includes(q) ||
      (m.normalized_question?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search markets..."
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 pl-11 text-sm placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 backdrop-blur-sm transition"
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
            onClick={() => setSearch("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results count */}
      {search && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} market{filtered.length !== 1 ? "s" : ""} found
        </p>
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

      {filtered.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            {search ? `No markets matching "${search}"` : "No markets found."}
          </p>
        </div>
      )}
    </div>
  );
}

