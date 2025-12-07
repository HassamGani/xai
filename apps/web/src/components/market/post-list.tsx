"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  posts: Post[];
  emptyMessage?: string;
};

type FilterType = "relevant" | "latest";

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

export function PostList({ marketId, posts, emptyMessage = "No curated posts yet." }: Props) {
  const [filter, setFilter] = useState<FilterType>("relevant");
  const [data, setData] = useState<Post[]>(posts);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(posts.length);
  const [hasMore, setHasMore] = useState(true);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [loadingAvatars, setLoadingAvatars] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Fetch existing avatars on mount or data change
  useEffect(() => {
    const authorIds = [...new Set(data.map((p) => p.author_id).filter(Boolean))] as string[];
    if (authorIds.length === 0) return;

    fetch(`/api/avatars/generate?ids=${authorIds.join(",")}`)
      .then((res) => res.json())
      .then((resp) => {
        if (resp.avatars) {
          setAvatars(resp.avatars);
        }
      })
      .catch(console.error);
  }, [data]);

  // Sync when SSR posts change
  useEffect(() => {
    setData(posts);
    setOffset(posts.length);
    setHasMore(true);
  }, [posts]);

  // Initial refresh on mount for freshest posts
  useEffect(() => {
    handleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPosts = async (newOffset: number, replace = false) => {
    const limit = 20;
    const url = `/api/markets/${marketId}/posts?limit=${limit}&offset=${newOffset}`;
    const res = await fetch(url);
    if (!res.ok) {
      setError("Failed to load posts");
      return;
    }
    const json = await res.json();
    const fetched: Post[] = json.posts || [];
    if (replace) {
      setData(fetched);
      setOffset(fetched.length);
      setHasMore(fetched.length >= limit);
    } else {
      setData((prev) => [...prev, ...fetched]);
      setOffset((prev) => prev + fetched.length);
      if (fetched.length < limit) setHasMore(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchPosts(0, true);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await fetchPosts(offset, false);
    } finally {
      setLoadingMore(false);
    }
  };

  // Generate avatar for an author
  const generateAvatar = async (authorId: string, sampleTweet?: string) => {
    if (loadingAvatars.has(authorId) || avatars[authorId]) return;
    
    setLoadingAvatars(prev => new Set(prev).add(authorId));
    
    try {
      const res = await fetch("/api/avatars/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author_id: authorId, sample_tweet: sampleTweet })
      });
      
      const data = await res.json();
      if (data.avatar_data) {
        setAvatars(prev => ({ ...prev, [authorId]: data.avatar_data }));
      }
    } catch (error) {
      console.error("Avatar generation failed:", error);
    } finally {
      setLoadingAvatars(prev => {
        const next = new Set(prev);
        next.delete(authorId);
        return next;
      });
    }
  };

  if (!data.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const sortedPosts = [...data].sort((a, b) => {
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
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-3">
        {sortedPosts.map((p) => {
          const authorId = p.author_id || "unknown";
          const handle = p.author_username || `user-${authorId}`;
          const hasAvatar = !!avatars[authorId];
          const isLoading = loadingAvatars.has(authorId);
          
          return (
            <article
              key={p.id}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30"
            >
              {/* AI Analysis Banner */}
              {p.reason && (
                <div className="mb-3 pb-3 border-b border-border">
                  <div className="flex items-start gap-2">
                    <div className="p-1 rounded bg-primary/10 shrink-0">
                      <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">AI Analysis:</span> {p.reason}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                {/* Avatar */}
                <div className="shrink-0">
                  {hasAvatar ? (
                    <img
                      src={avatars[authorId]}
                      alt={`@${authorId}`}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => {
                        // Fallback to gradient on error
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                        target.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : null}
                  <div 
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm cursor-pointer transition-transform hover:scale-105 ${hasAvatar ? "hidden" : ""}`}
                    style={{ background: generatePlaceholderAvatar(authorId) }}
                    onClick={() => !isLoading && generateAvatar(authorId, p.text || undefined)}
                    title={isLoading ? "Generating..." : "Click to generate AI avatar"}
                  >
                    {isLoading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      authorId.charAt(0).toUpperCase()
                    )}
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
                        {getRelativeTime(p.scored_at)}
                      </span>
                    </div>

                    {/* Badges */}
                    <div className="flex gap-1.5 shrink-0">
                      {p.stance_label && (
                        <Badge 
                          variant="secondary" 
                          className="text-[10px] px-1.5 py-0"
                        >
                          {p.stance_label}
                        </Badge>
                      )}
                      {p.credibility_label && (
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1.5 py-0 ${
                            p.credibility_label === "High" 
                              ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" 
                              : p.credibility_label === "Low"
                                ? "border-rose-500/50 text-rose-600 dark:text-rose-400"
                                : ""
                          }`}
                        >
                          {p.credibility_label}
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
          <Button variant="ghost" size="sm" onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
