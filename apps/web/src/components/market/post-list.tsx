"use client";

import { useState } from "react";
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

// Format large numbers nicely
function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// Get relative time string
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

// Parse and render text with highlighted @mentions and links
function renderPostText(text: string) {
  // Regex patterns
  const mentionRegex = /@(\w+)/g;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const hashtagRegex = /#(\w+)/g;

  // Split text into parts
  const parts: Array<{ type: "text" | "mention" | "url" | "hashtag"; content: string }> = [];
  let lastIndex = 0;

  // Combined regex
  const combinedRegex = /(@\w+|https?:\/\/[^\s]+|#\w+)/g;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    // Determine type and add
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

  // Add remaining text
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

// Generate avatar color from author_id
function getAvatarColor(authorId: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-rose-500", 
    "bg-amber-500", "bg-cyan-500", "bg-indigo-500", "bg-pink-500"
  ];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

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
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm ${
                    p.author_id ? getAvatarColor(p.author_id) : "bg-muted"
                  }`}
                >
                  {p.author_id ? p.author_id.charAt(0).toUpperCase() : "?"}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-foreground truncate">
                      {p.author_id ? `@${p.author_id}` : "Unknown"}
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
                <div className="mt-3 flex items-center gap-4 text-muted-foreground">
                  {p.author_followers != null && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span>{formatFollowers(p.author_followers)} followers</span>
                    </div>
                  )}
                  {p.summary && p.summary !== p.text?.slice(0, 80) && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="truncate max-w-[200px]">{p.summary}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
