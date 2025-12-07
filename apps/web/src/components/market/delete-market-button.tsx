"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  marketId: string;
};

export function DeleteMarketButton({ marketId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = async () => {
    setError(null);

    const confirm1 = window.confirm(
      "Developer-only: Permanently delete this market and all related data?"
    );
    if (!confirm1) return;
    const confirm2 = window.confirm("This cannot be undone. Confirm delete?");
    if (!confirm2) return;

    const devSecret = window.prompt("Enter developer secret to confirm:");
    if (!devSecret) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/delete`, {
        method: "POST",
        headers: { "x-dev-secret": devSecret }
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to delete market");
        return;
      }
      // Navigate back to home after deletion
      router.push("/");
      router.refresh();
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDelete}
        disabled={loading}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {loading ? "Deleting..." : "Delete market (developer only)"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

