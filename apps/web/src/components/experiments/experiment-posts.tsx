"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Post = {
  id: string;
  text?: string | null;
  author_id?: string | null;
  author_username?: string | null;
  author_followers?: number | null;
  profile_image_url?: string | null;
  post_created_at?: string | null;
  x_post_id?: string | null;
  display_labels?: {
    summary?: string;
    relevance_score?: number;
    stance_label?: string | null;
    credibility_label?: string | null;
  } | null;
};

type Props = {
  experimentId: string;
};

type FilterType = "relevant" | "oldest" | "newest";

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderPostText(text: string) {
  const combinedRegex = /(@\w+|https?:\/\/[^\s]+|#\w+)/g;
  const parts: Array<{ type: "text" | "mention" | "url" | "hashtag"; content: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    const matchText = match[0];
    if (matchText.startsWith("@")) {
      parts.push({ type: "mention", content: matchText });
    } else if (matchText.startsWith("http")) {
      parts.push({ type: "url", content: matchText });
    } else if (matchText.startsWith("#")) {
      parts.push({ type: "hashtag", content: matchText });
    }

    lastIndex = match.index + matchText.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return parts.map((part, i) => {
    switch (part.type) {
      case "mention":
        return (
          <span key={i} className="text-primary hover:underline cursor-pointer font-medium">
            {part.content}
          </span>
        );
      case "url":
        const displayUrl = part.content.replace(/^https?:\/\//, "").slice(0, 30);
        return (
          <a
            key={i}
            href={part.content}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {displayUrl}
            {part.content.length > 30 ? "…" : ""}
          </a>
        );
      case "hashtag":
        return (
          <span key={i} className="text-primary hover:underline cursor-pointer">
            {part.content}
          </span>
        );
      default:
        return <span key={i}>{part.content}</span>;
    }
  });
}

// Generate a placeholder gradient avatar
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<FilterType>("oldest");

  const load = async (reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
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
        setHasMore(fetched.length >= limit);
      } else {
        setPosts((prev) => [...prev, ...fetched]);
        setOffset((prev) => prev + fetched.length);
        if (fetched.length < limit) setHasMore(false);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load posts");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId]);

  // Sort posts based on filter
  const sortedPosts = [...posts].sort((a, b) => {
    if (filter === "newest") {
      return new Date(b.post_created_at || 0).getTime() - new Date(a.post_created_at || 0).getTime();
    }
    if (filter === "oldest") {
      return new Date(a.post_created_at || 0).getTime() - new Date(b.post_created_at || 0).getTime();
    }
    // relevant
    const relA = a.display_labels?.relevance_score ?? (a.author_followers ? Math.log10(a.author_followers) / 10 : 0);
    const relB = b.display_labels?.relevance_score ?? (b.author_followers ? Math.log10(b.author_followers) / 10 : 0);
    return relB - relA;
  });

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold mr-2">Posts ({posts.length})</h3>
        <Button
          variant={filter === "oldest" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("oldest")}
        >
          Oldest First
        </Button>
        <Button
          variant={filter === "newest" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("newest")}
        >
          Newest First
        </Button>
        <Button
          variant={filter === "relevant" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("relevant")}
        >
          Most Relevant
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {posts.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No posts stored for this experiment.</p>
      )}

      <div className="space-y-3">
        {sortedPosts.map((p) => {
          const authorId = p.author_id || "unknown";
          const handle = p.author_username || `user-${authorId}`;
          const hasRealAvatar = !!p.profile_image_url;
          const stanceLabel = p.display_labels?.stance_label;
          const credLabel = p.display_labels?.credibility_label;
          const summary = p.display_labels?.summary;

          return (
            <article
              key={p.id}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
            >
              {/* AI Analysis Banner */}
              {summary && (
                <div className="mb-3 pb-3 border-b border-border">
                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-primary/10 shrink-0">
                      <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">AI Analysis:</span> {summary}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                {/* Avatar */}
                <div className="shrink-0">
                  {hasRealAvatar ? (
                    <img
                      src={p.profile_image_url!}
                      alt={`@${handle}`}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                        target.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm ${hasRealAvatar ? "hidden" : ""}`}
                    style={{ background: generatePlaceholderAvatar(authorId) }}
                  >
                    {handle.charAt(0).toUpperCase()}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        @{handle}
                      </span>
                      {p.author_followers != null && p.author_followers >= 10000 && (
                        <svg className="w-4 h-4 text-primary shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                        </svg>
                      )}
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="text-muted-foreground text-sm shrink-0">
                        {p.post_created_at ? getRelativeTime(p.post_created_at) : ""}
                      </span>
                    </div>

                    {/* Badges */}
                    <div className="flex gap-1.5 shrink-0">
                      {stanceLabel && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {stanceLabel}
                        </Badge>
                      )}
                      {credLabel && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            credLabel === "High"
                              ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                              : credLabel === "Low"
                                ? "border-rose-500/50 text-rose-600 dark:text-rose-400"
                                : ""
                          }`}
                        >
                          {credLabel}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Post Text */}
                  {p.text && (
                    <p className="mt-1 text-[15px] text-foreground leading-normal whitespace-pre-wrap break-words">
                      {renderPostText(p.text)}
                    </p>
                  )}

                  {/* Footer Stats */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-muted-foreground">
                      {p.author_followers != null && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <span>{formatFollowers(p.author_followers)} followers</span>
                        </div>
                      )}
                      {p.post_created_at && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span>{new Date(p.post_created_at).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    {/* View on X button */}
                    {p.x_post_id && (
                      <a
                        href={
                          p.author_username
                            ? `https://x.com/${p.author_username}/status/${p.x_post_id}`
                            : `https://x.com/i/user/${p.author_id}/status/${p.x_post_id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        <span>View on X</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => load(false)} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
