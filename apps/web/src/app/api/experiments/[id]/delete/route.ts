import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Delete an experiment and all related data.
 * Uses POST method like market delete for consistency.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  try {
    // Delete related rows in correct order (children first)
    const tables = [
      { table: "experiment_posts", column: "experiment_id" },
      { table: "experiment_snapshots", column: "experiment_id" },
      { table: "experiment_runs", column: "experiment_id" },
      { table: "experiment_markets", column: "id" }
    ];

    for (const { table, column } of tables) {
      const { error } = await supabase.from(table).delete().eq(column, id);
      if (error) {
        console.error(`Failed to delete from ${table}:`, error);
      }
    }

    revalidatePath("/experiments");
    revalidatePath(`/experiments/${id}`);

    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    console.error("Delete experiment error:", err);
    return NextResponse.json({ error: "Failed to delete experiment" }, { status: 500 });
  }
}

// Also support DELETE method for backwards compatibility
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return POST(request, context);
}
