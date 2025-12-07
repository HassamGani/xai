"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type Props = {
  marketId: string;
  outcomeId: string;
  label: string;
  onChange?: () => void;
};

export function RemoveTickerButton({ marketId, outcomeId, label, onChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleRemove = async () => {
    setError(null);
    const confirm1 = window.confirm(`Remove ticker "${label}"?`);
    if (!confirm1) return;
    const confirm2 = window.confirm("This will re-normalize probabilities. Proceed?");
    if (!confirm2) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/remove-ticker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome_id: outcomeId })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove ticker");
        return;
      }
      router.refresh();
      onChange?.();
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="ghost" size="sm" onClick={handleRemove} disabled={loading}>
        {loading ? "Removing..." : `Remove "${label}"`}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

