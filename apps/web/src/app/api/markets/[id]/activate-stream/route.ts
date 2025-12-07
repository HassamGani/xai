import { NextRequest, NextResponse } from "next/server";

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/markets/[id]/activate-stream
 * Activates X filtered stream rules for a specific market
 * This is called when a new market is created
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;

  if (!X_BEARER_TOKEN) {
    return NextResponse.json(
      { error: "X_BEARER_TOKEN not configured" },
      { status: 500 }
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch the market from Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("id, question, x_rule_templates, status")
      .eq("id", marketId)
      .single();

    if (marketError || !market) {
      return NextResponse.json(
        { error: "Market not found", details: marketError },
        { status: 404 }
      );
    }

    if (!market.x_rule_templates || market.x_rule_templates.length === 0) {
      return NextResponse.json(
        { error: "Market has no X rule templates" },
        { status: 400 }
      );
    }

    // Add rules to X filtered stream
    const rules = market.x_rule_templates.map((template: string, index: number) => ({
      value: template,
      tag: `market:${marketId}:${index}`,
    }));

    console.log(`[activate-stream] Adding ${rules.length} rules for market ${marketId}`);
    console.log("[activate-stream] Rules:", rules);

    const addResponse = await fetch(
      "https://api.twitter.com/2/tweets/search/stream/rules",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${X_BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ add: rules }),
      }
    );

    if (!addResponse.ok) {
      const errorText = await addResponse.text();
      console.error("[activate-stream] X API error:", errorText);
      return NextResponse.json(
        { error: "Failed to add X stream rules", details: errorText },
        { status: 500 }
      );
    }

    const result = await addResponse.json();
    console.log("[activate-stream] Rules added:", result.meta);

    // Mark market as stream_active (if column exists)
    await supabase
      .from("markets")
      .update({ stream_active: true })
      .eq("id", marketId);

    return NextResponse.json({
      success: true,
      marketId,
      rulesAdded: result.meta?.summary?.created || rules.length,
      message: `Stream activated for market: ${market.question}`,
    });
  } catch (error) {
    console.error("[activate-stream] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/markets/[id]/activate-stream
 * Deactivates X filtered stream rules for a specific market
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;

  if (!X_BEARER_TOKEN) {
    return NextResponse.json(
      { error: "X_BEARER_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    // Get current rules
    const rulesResponse = await fetch(
      "https://api.twitter.com/2/tweets/search/stream/rules",
      {
        headers: {
          Authorization: `Bearer ${X_BEARER_TOKEN}`,
        },
      }
    );

    if (!rulesResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch current rules" },
        { status: 500 }
      );
    }

    const rulesData = await rulesResponse.json();
    const allRules = rulesData.data || [];

    // Find rules for this market
    const marketRules = allRules.filter((rule: { tag: string; id: string }) =>
      rule.tag.startsWith(`market:${marketId}:`)
    );

    if (marketRules.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active rules for this market",
      });
    }

    // Delete the rules
    const deleteResponse = await fetch(
      "https://api.twitter.com/2/tweets/search/stream/rules",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${X_BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          delete: { ids: marketRules.map((r: { id: string }) => r.id) },
        }),
      }
    );

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      return NextResponse.json(
        { error: "Failed to delete rules", details: errorText },
        { status: 500 }
      );
    }

    const result = await deleteResponse.json();

    return NextResponse.json({
      success: true,
      rulesDeleted: result.meta?.summary?.deleted || marketRules.length,
    });
  } catch (error) {
    console.error("[deactivate-stream] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}

