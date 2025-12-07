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
  relevance_score?: number;
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
        >
          Most Relevant
        </Button>
        <Button
          variant={filter === "latest" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("latest")}
        >
          Latest
        </Button>
      </div>

      <div className="space-y-3">
        {sortedPosts.map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <CardTitle className="text-sm leading-snug">
                    {p.summary ?? p.text?.slice(0, 80) ?? "Post"}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {new Date(p.scored_at).toLocaleString()}
                    {p.author_id && ` · @${p.author_id}`}
                  </CardDescription>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {p.stance_label && (
                    <Badge variant="secondary" className="text-[10px]">
                      {p.stance_label}
                    </Badge>
                  )}
                  {p.credibility_label && (
                    <Badge variant="outline" className="text-[10px]">
                      {p.credibility_label}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {p.reason && (
                <p className="text-xs text-primary/80 mb-2 border-l-2 border-primary/30 pl-2">
                  {p.reason}
                </p>
              )}
              {p.text && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {p.text}
                </p>
              )}
              {p.author_followers != null && (
                <p className="mt-2 text-[10px] text-muted-foreground">
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
