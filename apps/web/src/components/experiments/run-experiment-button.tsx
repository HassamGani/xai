"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  experimentId: string;
  onFinished?: () => void;
};

export function RunExperimentButton({ experimentId, onFinished }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${experimentId}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Run failed");
      if (onFinished) onFinished();
    } catch (e: any) {
      setError(e.message || "Run failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={run} disabled={loading}>
        {loading ? "Running..." : "Run again"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

