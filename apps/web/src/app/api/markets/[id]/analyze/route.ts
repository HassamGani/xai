import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

type AnalysisDepth = "shallow" | "medium" | "deep";

const DEPTH_CONFIG: Record<AnalysisDepth, { maxTokens: number; wordGuide: string; sections: string }> = {
  shallow: {
    maxTokens: 400,
    wordGuide: "Keep response under 200 words. Be extremely concise.",
    sections: `Provide a BRIEF analysis with:
- **Summary**: 2-3 sentences on current state
- **Key Driver**: The single most important factor
- **Outlook**: 1 sentence prediction`
  },
  medium: {
    maxTokens: 800,
    wordGuide: "Keep response around 400 words. Be focused and clear.",
    sections: `Provide analysis covering:
1. **Current State**: Brief summary of probabilities
2. **Key Movements**: Notable spikes, drops, or trends
3. **Real-World Context**: Connect to 2-3 relevant news events
4. **Outlook**: Forward-looking perspective`
  },
  deep: {
    maxTokens: 1500,
    wordGuide: "Provide comprehensive analysis around 800 words.",
    sections: `Provide detailed analysis covering:
1. **Current State**: Thorough summary of where probabilities stand
2. **Historical Trend Analysis**: Detailed timeline of movements
3. **Real-World Context**: Connect probability changes to specific news events, announcements, policy changes
4. **Sentiment Analysis**: What posts and public discourse suggest
5. **Key Factors**: List the main drivers affecting each outcome
6. **Outlook**: Detailed forward-looking perspective with scenarios`
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const marketId = params.id;
    const { searchParams } = new URL(request.url);
    const depth = (searchParams.get("depth") as AnalysisDepth) || "medium";
    const depthConfig = DEPTH_CONFIG[depth] || DEPTH_CONFIG.medium;
    
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

    // Get probability snapshots
    const { data: snapshots } = await supabase
      .from("probability_snapshots")
      .select("timestamp, probabilities")
      .eq("market_id", marketId)
      .order("timestamp", { ascending: true })
      .limit(depth === "deep" ? 100 : 50);

    // Get recent posts for context
    const { data: scoredPosts } = await supabase
      .from("scored_posts")
      .select("raw_post_id, scores, display_labels, scored_at")
      .eq("market_id", marketId)
      .order("scored_at", { ascending: false })
      .limit(depth === "deep" ? 20 : 10);

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
      .map(o => `- ${o.label} (${o.outcome_id}): ${((o.current_probability ?? 0) * 100).toFixed(1)}%`)
      .join("\n");

    const snapshotsSummary = (snapshots ?? []).map(s => {
      const probs = Object.entries(s.probabilities as Record<string, number>)
        .map(([k, v]) => `${k.trim()}: ${(v * 100).toFixed(1)}%`)
        .join(", ");
      return `${new Date(s.timestamp).toISOString().slice(0, 16)}: ${probs}`;
    }).join("\n");

    const postsContext = (recentPosts ?? [])
      .filter(p => p.raw_posts && (p.raw_posts as any).text)
      .map(p => {
        const raw = p.raw_posts as any;
        const labels = p.display_labels as any;
        return `- @${raw.author_id || "unknown"}: "${raw.text?.slice(0, 120)}..." ${labels?.stance_label ? `[${labels.stance_label}]` : ""}`;
      })
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are an expert prediction market analyst. Today is ${today}.

${depthConfig.wordGuide}

${depthConfig.sections}

IMPORTANT INSTRUCTIONS:
- Use web search to find recent news about this topic
- Include citation markers like [1], [2] when referencing specific news or sources
- Be specific about dates and events
- Write in a professional, analytical tone
- Focus on FACTS and real events, not speculation`;

    const userPrompt = `Analyze this prediction market and search the web for relevant recent news:

**Question**: ${market.question}
${market.normalized_question ? `**Normalized**: ${market.normalized_question}` : ""}

**Current Probabilities**:
${outcomesStr}

**Probability History** (${snapshots?.length || 0} data points):
${snapshotsSummary || "No historical data yet"}

**Recent X Posts**:
${postsContext || "No recent posts"}

Search the web for recent news about "${market.question}" and provide your analysis with source citations.`;

    console.log("Calling Grok API for market analysis:", marketId, "depth:", depth);
    
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
        temperature: 0.3,
        max_tokens: depthConfig.maxTokens,
        search: true // Enable web search
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

    // Extract citations from search results if available
    const citations: Array<{ title: string; url: string; snippet?: string }> = [];
    
    // Check for search results in Grok response
    if (data.search_results && Array.isArray(data.search_results)) {
      data.search_results.forEach((result: any, idx: number) => {
        if (result.url && result.title) {
          citations.push({
            title: result.title,
            url: result.url,
            snippet: result.snippet || result.description
          });
        }
      });
    }
    
    // Also try to extract from the message context if search results are embedded differently
    if (citations.length === 0 && data.choices?.[0]?.message?.context) {
      const context = data.choices[0].message.context;
      if (Array.isArray(context)) {
        context.forEach((item: any) => {
          if (item.url && item.title) {
            citations.push({
              title: item.title,
              url: item.url,
              snippet: item.snippet
            });
          }
        });
      }
    }

    return NextResponse.json({
      analysis,
      citations,
      depth,
      generated_at: new Date().toISOString(),
      market_id: marketId
    });
  } catch (error) {
    console.error("Analysis endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
