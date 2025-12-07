"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Post = {
  id: string;
  text?: string | null;
  author_id?: string | null;
  author_followers?: number | null;
  scored_at: string;
  stance_label?: string;
  credibility_label?: string;
  summary?: string;
  reason?: string;
  relevance_score?: number; // Added for sorting
};

type Props = {
  posts: Post[];
  emptyMessage?: string;
};

type FilterType = "relevant" | "latest";

export function PostList({ posts, emptyMessage = "No curated posts yet." }: Props) {
  const [filter, setFilter] = useState<FilterType>("relevant");

  if (!posts.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const sortedPosts = [...posts].sort((a, b) => {
    if (filter === "latest") {
      return new Date(b.scored_at).getTime() - new Date(a.scored_at).getTime();
    }
    // Sort by relevance (fallback to followers if relevance missing)
    const valA = a.relevance_score ?? (a.author_followers ? Math.log10(a.author_followers) / 10 : 0);
    const valB = b.relevance_score ?? (b.author_followers ? Math.log10(b.author_followers) / 10 : 0);
    return valB - valA;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <Button
          variant={filter === "relevant" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("relevant")}
          className="text-xs h-8"
        >
          Most Relevant
        </Button>
        <Button
          variant={filter === "latest" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("latest")}
          className="text-xs h-8"
        >
          Latest
        </Button>
      </div>

      <div className="grid gap-3">
        {sortedPosts.map((p) => (
          <Card key={p.id} className="border border-white/15 bg-white/5 transition hover:bg-white/10">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base leading-snug">{p.summary ?? p.text?.slice(0, 60) ?? "Post"}</CardTitle>
                <CardDescription className="text-xs">
                  {new Date(p.scored_at).toLocaleString()} • {p.author_id ? `@${p.author_id}` : "Unknown"}
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                {p.stance_label && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 h-5">
                    {p.stance_label}
                  </Badge>
                )}
                {p.credibility_label && (
                  <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                    {p.credibility_label}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {p.reason && (
                <p className="text-xs text-blue-300 mb-2 italic border-l-2 border-blue-500/50 pl-2">
                  AI: {p.reason}
                </p>
              )}
              {p.text && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {p.text}
                </p>
              )}
              {p.author_followers !== null && p.author_followers !== undefined && (
                <p className="mt-2 text-[10px] text-muted-foreground/60">
                  {p.author_followers.toLocaleString()} followers
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
