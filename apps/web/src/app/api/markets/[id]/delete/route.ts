import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Developer-only market deletion.
 * - Requires header: x-dev-secret matching INTERNAL_DEV_SECRET
 * - Deletes market, related rows, and X stream rules
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const suppliedSecret = request.headers.get("x-dev-secret");
  const internalSecret = process.env.INTERNAL_DEV_SECRET;

  if (!internalSecret || suppliedSecret !== internalSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // Remove X rules for this market if bearer token exists
    const bearer = process.env.X_BEARER_TOKEN;
    if (bearer) {
      const rulesRes = await fetch("https://api.twitter.com/2/tweets/search/stream/rules", {
        headers: { Authorization: `Bearer ${bearer}` }
      });
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        const toDelete =
          data.data
            ?.filter((r: { tag: string }) => r.tag?.startsWith(`market:${id}:`))
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
    }

    // Delete related rows (order matters for FK)
    const tables = [
      "scored_posts",
      "raw_posts",
      "probability_snapshots",
      "market_state",
      "outcomes",
      "markets"
    ];

    for (const table of tables) {
      await supabase.from(table).delete().eq("market_id", id);
      if (table === "markets") {
        await supabase.from(table).delete().eq("id", id);
      }
    }

    revalidatePath("/");
    revalidatePath(`/market/${id}`);

    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    console.error("Delete market error:", err);
    return NextResponse.json({ error: "Failed to delete market" }, { status: 500 });
  }
}

