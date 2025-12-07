import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const marketId = params.id;
    const apiKey = process.env.GROK_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json({ 
        error: "Grok API key not configured. Add GROK_API_KEY to environment variables." 
      }, { status: 503 });
    }

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

    // Get outcomes
    const { data: outcomes } = await supabase
      .from("outcomes")
      .select("outcome_id, label, current_probability")
      .eq("market_id", marketId);

    // Get probability snapshots (last 50 for trend analysis)
    const { data: snapshots } = await supabase
      .from("probability_snapshots")
      .select("timestamp, probabilities")
      .eq("market_id", marketId)
      .order("timestamp", { ascending: true })
      .limit(50);

    // Get recent posts for context (simpler query without join)
    const { data: scoredPosts } = await supabase
      .from("scored_posts")
      .select("raw_post_id, scores, display_labels, scored_at")
      .eq("market_id", marketId)
      .order("scored_at", { ascending: false })
      .limit(15);

    // Get raw posts separately
    const rawPostIds = (scoredPosts ?? []).map(p => p.raw_post_id);
    const { data: rawPosts } = rawPostIds.length > 0 
      ? await supabase.from("raw_posts").select("id, text, author_id, author_followers").in("id", rawPostIds)
      : { data: [] };
    
    const rawPostMap = new Map((rawPosts ?? []).map(p => [p.id, p]));
    const recentPosts = (scoredPosts ?? []).map(sp => ({
      ...sp,
      raw_posts: rawPostMap.get(sp.raw_post_id)
    }));

    // Format data for Grok
    const outcomesStr = (outcomes ?? [])
      .map(o => `- ${o.label} (${o.outcome_id}): currently ${((o.current_probability ?? 0) * 100).toFixed(1)}%`)
      .join("\n");

    const snapshotsSummary = (snapshots ?? []).map(s => {
      const probs = Object.entries(s.probabilities as Record<string, number>)
        .map(([k, v]) => `${k.trim()}: ${(v * 100).toFixed(1)}%`)
        .join(", ");
      return `${new Date(s.timestamp).toISOString().slice(0, 16)}: ${probs}`;
    }).join("\n");

    const postsContext = (recentPosts ?? [])
      .filter(p => p.raw_posts && (p.raw_posts as any).text)
      .slice(0, 10)
      .map(p => {
        const raw = p.raw_posts as any;
        const labels = p.display_labels as any;
        return `- @${raw.author_id || "unknown"} (${raw.author_followers?.toLocaleString() || "?"} followers): "${raw.text?.slice(0, 150)}..." ${labels?.stance_label ? `[${labels.stance_label}]` : ""}`;
      })
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are an expert prediction market analyst with real-time knowledge of world events. Today is ${today}.

Your task is to analyze a prediction market's probability history and explain what real-world events or trends have influenced the probabilities.

Provide a comprehensive but concise analysis covering:
1. **Current State**: Brief summary of where probabilities stand now
2. **Key Movements**: Identify significant spikes, drops, or trends in the data
3. **Real-World Context**: Connect probability changes to actual news events, announcements, or developments
4. **Recent Sentiment**: Summarize what the recent posts suggest about public perception
5. **Outlook**: Brief forward-looking perspective based on current trends

Be specific about dates and events when possible. Reference actual news if you know what happened.
Keep the analysis focused and readable - use bullet points and clear sections.
Write in a professional but accessible tone, like a financial analyst report.`;

    const userPrompt = `Analyze this prediction market:

**Question**: ${market.question}
${market.normalized_question ? `**Normalized**: ${market.normalized_question}` : ""}

**Outcomes**:
${outcomesStr}

**Probability History** (oldest to newest):
${snapshotsSummary || "No historical data yet"}

**Recent Posts/Sentiment**:
${postsContext || "No recent posts"}

Please provide your analysis of what's driving these probabilities and any notable patterns or events.`;

    console.log("Calling Grok API for market analysis:", marketId);
    
    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-3-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Grok API error:", response.status, err);
      return NextResponse.json({ 
        error: `Grok API error: ${response.status}. Check API key and quota.` 
      }, { status: 500 });
    }

    const data = await response.json();
    console.log("Grok API response received");
    
    const analysis = data.choices?.[0]?.message?.content;

    if (!analysis) {
      console.error("No analysis in Grok response:", JSON.stringify(data).slice(0, 500));
      return NextResponse.json({ error: "No analysis generated" }, { status: 500 });
    }

    return NextResponse.json({
      analysis,
      generated_at: new Date().toISOString(),
      market_id: marketId
    });
  } catch (error) {
    console.error("Analysis endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

