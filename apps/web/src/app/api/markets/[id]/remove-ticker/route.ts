import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) return json({ error: "Database not configured" }, 503);

  const body = await request.json();
  const outcomeId: string | undefined = body?.outcome_id;
  if (!outcomeId) return json({ error: "outcome_id required" }, 400);

  // Fetch market state and outcomes
  const [{ data: market }, { data: outcomes }] = await Promise.all([
    supabase.from("markets").select("*").eq("id", marketId).single(),
    supabase.from("outcomes").select("*").eq("market_id", marketId)
  ]);
  if (!market) return json({ error: "Market not found" }, 404);

  const remaining = (outcomes ?? []).filter((o) => o.outcome_id !== outcomeId);
  if (remaining.length === outcomes?.length) return json({ error: "Ticker not found" }, 404);
  if (remaining.length === 0) return json({ error: "Cannot remove last ticker" }, 400);

  // Renormalize probabilities
  const state = (
    await supabase.from("market_state").select("*").eq("market_id", marketId).single()
  ).data;
  const prevProbs: Record<string, number> = state?.probabilities || {};
  let removedProb = prevProbs[outcomeId] ?? 0;
  const scale = removedProb > 0 ? 1 / (1 - removedProb) : 1;
  const newProbs: Record<string, number> = {};
  for (const o of remaining) {
    const p = prevProbs[o.outcome_id] ?? 1 / remaining.length;
    newProbs[o.outcome_id] = Math.max(0.001, p * scale);
  }
  // normalize
  const total = Object.values(newProbs).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(newProbs)) newProbs[k] = newProbs[k] / total;

  // Delete outcome row
  await supabase.from("outcomes").delete().eq("market_id", marketId).eq("outcome_id", outcomeId);

  // Update market_state and snapshot
  await supabase.from("market_state").upsert({
    market_id: marketId,
    probabilities: newProbs,
    updated_at: new Date().toISOString()
  });
  await supabase.from("probability_snapshots").insert({
    market_id: marketId,
    probabilities: newProbs
  });

  // Try to remove matching X rules (best-effort: delete rules whose value contains label/outcomeId)
  const bearer = process.env.X_BEARER_TOKEN;
  if (bearer) {
    try {
      const rulesRes = await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
        headers: { Authorization: `Bearer ${bearer}` }
      });
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        const toDelete =
          data.data
            ?.filter(
              (r: { id: string; tag?: string; value?: string }) =>
                r.tag?.startsWith(`market:${marketId}:`) &&
                (r.value?.toLowerCase().includes(outcomeId.toLowerCase()) ?? false)
            )
            .map((r: { id: string }) => r.id) ?? [];
        if (toDelete.length > 0) {
          await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearer}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ delete: { ids: toDelete } })
          });
        }
      }
    } catch (err) {
      console.error("Failed to remove X rules:", err);
    }
  }

  revalidatePath("/");
  revalidatePath(`/market/${marketId}`);

  return json({ success: true, outcome_removed: outcomeId, probabilities: newProbs });
}

