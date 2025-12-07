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

  const { error } = await supabase.from("experiment_markets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete", details: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

