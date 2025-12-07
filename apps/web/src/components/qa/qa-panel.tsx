"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PromptChip } from "./prompt-chip";

type QaResponse = {
  answer: string;
  intent: { intent: string; topics?: string[] };
  markets: Array<{
    id: string;
    question: string;
    normalized_question: string | null;
    delta?: number;
    top_outcome?: { outcome_id: string; label: string; probability: number };
  }>;
  drivers: Array<{
    market_id: string;
    summary?: string;
    reason?: string;
    text: string | null;
    author_username?: string | null;
  }>;
};

type QaPanelProps = {
  compact?: boolean;
};

export function QaPanel({ compact = false }: QaPanelProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<QaResponse | null>(null);
  const [displayedAnswer, setDisplayedAnswer] = useState("");

  async function handleAsk() {
    if (query.trim().length < 3) {
      setError("Ask a longer question");
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Request failed");
        return;
      }
      setResponse(json as QaResponse);
    } catch (err) {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!response?.answer) {
      setDisplayedAnswer("");
      return;
    }
    const text = response.answer;
    setDisplayedAnswer("");
    let i = 0;
    const step = Math.max(1, Math.floor(text.length / 80));
    const interval = window.setInterval(() => {
      i += step;
      setDisplayedAnswer(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(interval);
      }
    }, 12);
    return () => window.clearInterval(interval);
  }, [response]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{compact ? "Ask Grok about the markets" : "Ask about markets"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder={`Examples:\n- Which markets moved the most this week?\n- What's driving the Biden withdrawal odds higher?\n- Show me markets correlated with crypto prices`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            className="min-h-24"
          />
          <Button onClick={handleAsk} disabled={loading} className="sm:w-auto w-full">
            {loading ? "Asking..." : "Ask Grok"}
          </Button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <PromptChip
              text="Which markets moved the most this week?"
              onSelect={(t) => setQuery(t)}
              disabled={loading}
            />
            <PromptChip
              text="What’s driving the Biden withdrawal odds higher?"
              onSelect={(t) => setQuery(t)}
              disabled={loading}
            />
            <PromptChip
              text="Show me markets correlated with crypto prices."
              onSelect={(t) => setQuery(t)}
              disabled={loading}
            />
            <PromptChip
              text="Find markets about interest rates moving."
              onSelect={(t) => setQuery(t)}
              disabled={loading}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ask anything market-related; answers summarize movement and evidence.
          </p>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/50 border-t-transparent animate-spin" />
              <span>Grok is thinking...</span>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {response && (
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Answer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed min-h-[48px]">{displayedAnswer}</p>
              {response.intent?.topics && (
                <p className="text-xs text-muted-foreground">
                  Intent: {response.intent.intent} | Topics: {response.intent.topics.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Markets referenced</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {response.markets.length === 0 && (
                <p className="text-sm text-muted-foreground">No matching markets yet.</p>
              )}
              {response.markets.map((m) => (
                <div key={m.id} className="border rounded-md p-3">
                  <div className="flex justify-between gap-2">
                    <Link href={`/market/${m.id}`} className="font-medium hover:underline">
                      {m.question}
                    </Link>
                    {typeof m.delta === "number" && (
                      <span className="text-xs text-muted-foreground">
                        Δ {(m.delta * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {m.top_outcome && (
                    <p className="text-xs text-muted-foreground">
                      Lead: {m.top_outcome.label} ({(m.top_outcome.probability * 100).toFixed(1)}%)
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {response.drivers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Drivers (recent posts)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {response.drivers.map((d, idx) => (
                  <div key={`${d.market_id}-${idx}`} className="border rounded-md p-3 space-y-1">
                    <p className="text-sm">{d.summary ?? d.reason ?? d.text ?? "Post"}</p>
                    {d.author_username && (
                      <p className="text-xs text-muted-foreground">@{d.author_username}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
