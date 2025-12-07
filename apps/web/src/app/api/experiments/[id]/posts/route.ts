import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = paramsSchema.parse(params);
  const supabase = getSupabaseAdmin() || getSupabaseServer();
  if (!supabase) return NextResponse.json({ posts: [], error: "Database not configured" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

  const { data, error } = await supabase
    .from("experiment_posts")
    .select("*")
    .eq("experiment_id", id)
    .order("post_created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ posts: [], error: "Failed to fetch posts" }, { status: 500 });

  return NextResponse.json({ posts: data ?? [] });
}

