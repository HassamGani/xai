import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = paramsSchema.parse(params);

  // First check if experiment exists
  const { data: existing } = await supabase
    .from("experiment_markets")
    .select("id")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  // Delete related data first (cascade should handle this, but be explicit)
  await supabase.from("experiment_posts").delete().eq("experiment_id", id);
  await supabase.from("experiment_snapshots").delete().eq("experiment_id", id);
  await supabase.from("experiment_runs").delete().eq("experiment_id", id);

  // Delete the experiment
  const { error } = await supabase
    .from("experiment_markets")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: id });
}

