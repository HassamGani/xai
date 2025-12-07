"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

type Post = {
  id: string;
  text?: string | null;
  author_id?: string | null;
  author_username?: string | null;
  post_created_at?: string | null;
};

type Props = {
  experimentId: string;
};

export function ExperimentPosts({ experimentId }: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = async (reset = false) => {
    setLoading(true);
    setError(null);
    try {
      const limit = 20;
      const res = await fetch(
        `/api/experiments/${experimentId}/posts?limit=${limit}&offset=${reset ? 0 : offset}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load posts");
      const fetched: Post[] = data.posts || [];
      if (reset) {
        setPosts(fetched);
        setOffset(fetched.length);
      } else {
        setPosts((prev) => [...prev, ...fetched]);
        setOffset((prev) => prev + fetched.length);
      }
      if (fetched.length < limit) setHasMore(false);
    } catch (e: any) {
      setError(e.message || "Failed to load posts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Posts</h3>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {posts.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No posts stored for this experiment.</p>
      )}
      <div className="space-y-2">
        {posts.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-card/60 p-3">
            <div className="text-xs text-muted-foreground mb-1">
              @{p.author_username || p.author_id || "unknown"} •{" "}
              {p.post_created_at ? new Date(p.post_created_at).toLocaleString() : ""}
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{p.text}</p>
          </div>
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => load(false)} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

