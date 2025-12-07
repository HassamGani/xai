"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type Experiment = {
  id: string;
  question: string;
  normalized_question: string | null;
  resolution_outcome: string | null;
  resolved_at: string | null;
  created_at: string;
};

type Props = {
  experiments: Experiment[];
};

export function ExperimentsPanel({ experiments: initial }: Props) {
  const [experiments, setExperiments] = useState(initial);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createExperiment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          // Grok infers resolved outcome + date via search; no manual inputs
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create experiment");
      if (data.experiment) {
        setExperiments((prev) => [data.experiment, ...prev]);
        setQuestion("");
      }
    } catch (e: any) {
      setError(e.message || "Failed to create experiment");
    } finally {
      setLoading(false);
    }
  };

  const runExperiment = async (id: string) => {
    setRunLoading(id);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
      // no-op: data contains snapshots
    } catch (e: any) {
      setError(e.message || "Failed to run experiment");
    } finally {
      setRunLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Create experiment</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Use resolved questions to backtest the pipeline with synthesized timelines.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Question</label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder='e.g., "Who will win the US 2016 election?"'
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={createExperiment} disabled={loading || !question.trim()}>
              {loading ? "Creating..." : "Create experiment"}
            </Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-md font-semibold">Experiments</h3>
        {experiments.length === 0 && (
          <p className="text-sm text-muted-foreground">No experiments yet.</p>
        )}
        <div className="grid gap-3">
          {experiments.map((exp) => (
            <div
              key={exp.id}
              className="rounded-xl border border-border bg-card/70 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-semibold text-foreground">{exp.question}</h4>
                  {exp.normalized_question && (
                    <p className="text-xs text-muted-foreground">{exp.normalized_question}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Known outcome: {exp.resolution_outcome || "—"} • Resolved at:{" "}
                    {exp.resolved_at ? new Date(exp.resolved_at).toLocaleString() : "—"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => runExperiment(exp.id)}
                  disabled={runLoading === exp.id}
                >
                  {runLoading === exp.id ? "Running..." : "Run"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

