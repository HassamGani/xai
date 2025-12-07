"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

type Post = {
  id: string;
  text?: string | null;
  author_id?: string | null;
  author_username?: string | null;
  post_created_at?: string | null;
  x_post_id?: string | null;
};

type Props = {
  experimentId: string;
};

function generatePlaceholderAvatar(authorId: string): string {
  const colors = [
    ["#667eea", "#764ba2"],
    ["#f093fb", "#f5576c"],
    ["#4facfe", "#00f2fe"],
    ["#43e97b", "#38f9d7"],
    ["#fa709a", "#fee140"],
    ["#a8edea", "#fed6e3"],
    ["#ff9a9e", "#fecfef"],
    ["#ffecd2", "#fcb69f"],
  ];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorPair = colors[Math.abs(hash) % colors.length];
  return `linear-gradient(135deg, ${colorPair[0]} 0%, ${colorPair[1]} 100%)`;
}

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
    <div className="space-y-3">
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
      <div className="space-y-3">
        {posts.map((p) => {
          const authorId = p.author_id || "unknown";
          const handle = p.author_username || `user-${authorId}`;
          return (
            <article
              key={p.id}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
            >
              <div className="flex gap-3">
                {/* Avatar */}
                <div className="shrink-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                    style={{ background: generatePlaceholderAvatar(authorId) }}
                  >
                    {handle.charAt(0).toUpperCase()}
                  </div>
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        @{handle}
                      </span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-muted-foreground text-sm shrink-0">
                        {p.post_created_at ? new Date(p.post_created_at).toLocaleString() : ""}
                      </span>
                    </div>
                    {p.x_post_id && (
                      <a
                        href={
                          p.author_username
                            ? `https://x.com/${p.author_username}/status/${p.x_post_id}`
                            : `https://x.com/i/user/${p.author_id}/status/${p.x_post_id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        View on X
                      </a>
                    )}
                  </div>
                  {p.text && (
                    <p className="mt-1 text-[15px] text-foreground leading-normal whitespace-pre-wrap break-words">
                      {p.text}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
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

