"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";

export type Experiment = {
  id: string;
  question: string;
  normalized_question: string | null;
  resolution_outcome: string | null;
  resolved_at: string | null;
  created_at: string;
  last_run?: {
    status: string;
    started_at: string;
    finished_at: string | null;
    error?: string | null;
  } | null;
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
  const [listLoading, setListLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const createExperiment = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Failed to create experiment");
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

  const refreshList = async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments/list");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Failed to load experiments");
      if (data.experiments) {
        setExperiments(data.experiments);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load experiments");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    refreshList();
  }, []);

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

  const deleteExperiment = async (id: string) => {
    if (!confirm("Delete this experiment? This will remove runs and snapshots.")) return;
    setDeleting(id);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${id}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Failed to delete");
      setExperiments((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    } finally {
      setDeleting(null);
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
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold">Experiments</h3>
          <Button variant="ghost" size="sm" onClick={refreshList} disabled={listLoading}>
            {listLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
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
                  {exp.last_run && (
                    <p className="text-[11px] text-muted-foreground">
                      Last run: {exp.last_run.status} • Started{" "}
                      {new Date(exp.last_run.started_at).toLocaleString()}
                      {exp.last_run.finished_at ? ` • Finished ${new Date(exp.last_run.finished_at).toLocaleString()}` : ""}
                      {exp.last_run.error ? ` • Error: ${exp.last_run.error}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => runExperiment(exp.id)}
                    disabled={runLoading === exp.id}
                  >
                    {runLoading === exp.id ? "Running..." : "Run"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteExperiment(exp.id)}
                    disabled={deleting === exp.id}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {deleting === exp.id ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <Link
                  href={`/experiments/${exp.id}`}
                  className="text-primary hover:underline font-medium"
                >
                  View experiment
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

