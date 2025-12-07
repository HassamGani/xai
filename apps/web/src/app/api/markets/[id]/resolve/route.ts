import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkMarketResolution } from "@/lib/grok";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const marketId = params.id;

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Get market details
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("*")
      .eq("id", marketId)
      .single();

    if (marketError || !market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (market.resolved_at) {
      return NextResponse.json({
        action: "already_resolved",
        resolved_at: market.resolved_at,
        resolved_outcome_id: market.resolved_outcome_id,
        resolution_summary: market.resolution_summary
      });
    }

    // Get outcomes
    const { data: outcomes, error: outcomesError } = await supabase
      .from("outcomes")
      .select("id, outcome_id, label")
      .eq("market_id", marketId);

    if (outcomesError || !outcomes?.length) {
      return NextResponse.json({ error: "Failed to fetch outcomes" }, { status: 500 });
    }

    // Ask Grok to check resolution
    let resolution;
    try {
      resolution = await checkMarketResolution(
        market.question,
        market.normalized_question ?? market.question,
        market.resolution_criteria ?? "When the outcome becomes known",
        outcomes.map((o) => ({ outcome_id: o.outcome_id, label: o.label }))
      );
    } catch (grokError) {
      console.error("Grok resolution check error:", grokError);
      return NextResponse.json(
        { error: "Failed to check resolution status" },
        { status: 500 }
      );
    }

    if (!resolution.should_resolve || resolution.confidence < 0.95) {
      return NextResponse.json({
        action: "not_resolvable",
        confidence: resolution.confidence,
        reason: resolution.resolution_summary
      });
    }

    // Find the winning outcome's UUID
    const winningOutcome = outcomes.find(
      (o) => o.outcome_id === resolution.winning_outcome_id
    );

    if (!winningOutcome) {
      return NextResponse.json({
        action: "error",
        error: `Winning outcome '${resolution.winning_outcome_id}' not found in market outcomes`
      }, { status: 400 });
    }

    // Update market as resolved
    const { error: updateError } = await supabase
      .from("markets")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_outcome_id: winningOutcome.id,
        resolution_summary: resolution.resolution_summary,
        resolution_source: resolution.source_description
      })
      .eq("id", marketId);

    if (updateError) {
      console.error("Error updating market:", updateError);
      return NextResponse.json({ error: "Failed to update market" }, { status: 500 });
    }

    // Update winning outcome to 100% probability
    const finalProbabilities: Record<string, number> = {};
    for (const o of outcomes) {
      finalProbabilities[o.outcome_id] = o.outcome_id === resolution.winning_outcome_id ? 1.0 : 0.0;
    }

    await supabase.from("probability_snapshots").insert({
      market_id: marketId,
      probabilities: finalProbabilities
    });

    return NextResponse.json({
      action: "resolved",
      winning_outcome: {
        id: winningOutcome.id,
        outcome_id: winningOutcome.outcome_id,
        label: winningOutcome.label
      },
      resolution_summary: resolution.resolution_summary,
      resolution_source: resolution.source_description,
      confidence: resolution.confidence
    });
  } catch (error) {
    console.error("Resolution endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

