"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  marketId: string;
  existingLabels: string[];
};

function isSimilarLabel(label: string, existing: string) {
  const a = label.toLowerCase().trim();
  const b = existing.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = new Set(a.split(/\s+/).filter(Boolean));
  const bWords = new Set(b.split(/\s+/).filter(Boolean));
  if (!aWords.size || !bWords.size) return false;
  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  const jaccard = overlap / new Set([...aWords, ...bWords]).size;
  return jaccard >= 0.6;
}

export function AddTickerForm({ marketId, existingLabels }: Props) {
  const [label, setLabel] = useState("");
  const [rule, setRule] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    setError(null);
    const trimmedLabel = label.trim();
    const trimmedRule = rule.trim();
    if (trimmedLabel.length < 2) {
      setError("Label too short");
      return;
    }
    if (trimmedRule.length < 3) {
      setError("Rule template required");
      return;
    }
    // local similarity check
    if (existingLabels.some((l) => isSimilarLabel(trimmedLabel, l))) {
      setError("Ticker already exists or is too similar");
      return;
    }
    const devSecret = window.prompt("Enter developer secret to add ticker:");
    if (!devSecret) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/add-ticker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dev-secret": devSecret,
        },
        body: JSON.stringify({ label: trimmedLabel, rule_template: trimmedRule }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add ticker");
        return;
      }
      setLabel("");
      setRule("");
      router.refresh();
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
          placeholder="Ticker label (e.g., Spain)"
        />
        <input
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
          placeholder='X rule (e.g., "Spain World Cup" OR "#FIFA2026")'
        />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={handleSubmit} disabled={loading}>
          {loading ? "Adding..." : "Add ticker (developer only)"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Adds a new outcome and X stream rule instantly (filters auto-appended with -is:retweet lang:en). Prevents duplicate/similar tickers.
      </p>
    </div>
  );
}

