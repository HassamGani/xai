import { z } from "zod";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const MarketCreationResponseSchema = z.object({
  normalized_question: z.string(),
  estimated_resolution_date: z.string().nullable(),
  resolution_criteria: z.string(),
  outcomes: z.array(
    z.object({
      outcome_id: z.string(),
      label: z.string(),
      prior_probability: z.number()
    })
  ),
  x_rule_templates: z.array(z.string())
});

export type MarketCreationResponse = z.infer<typeof MarketCreationResponseSchema>;

const ResolutionCheckResponseSchema = z.object({
  should_resolve: z.boolean(),
  winning_outcome_id: z.string().nullable(),
  confidence: z.number(),
  resolution_summary: z.string(),
  source_description: z.string()
});

export type ResolutionCheckResponse = z.infer<typeof ResolutionCheckResponseSchema>;

const SimilarityCheckResponseSchema = z.object({
  is_similar: z.boolean(),
  similarity_score: z.number(),
  reasoning: z.string()
});

export async function createMarketFromQuestion(question: string): Promise<MarketCreationResponse> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY not configured");
  }

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `You are a prediction market creation assistant. Today's date is ${today}.

Given a user question about a future event, you must:

1. Normalize the question into a clear, unambiguous canonical form
2. Determine when this question can be definitively resolved (estimated_resolution_date)
3. Describe the specific criteria that would trigger resolution (resolution_criteria)
4. Generate 2-5 mutually exclusive, collectively exhaustive outcomes
5. Assign prior probabilities that sum to 1.0
6. Generate X (Twitter) filtered stream rule templates to capture relevant posts

For resolution timing, think carefully:
- Elections: Resolution when official results are certified/announced
- Sports events: When the game/match/event concludes
- Product launches: When officially announced or released
- Interviews/speeches: When the event occurs or shortly after
- Open-ended questions: Set a reasonable deadline based on context

Output ONLY valid JSON:
{
  "normalized_question": "Clear canonical question ending with ?",
  "estimated_resolution_date": "YYYY-MM-DD (best estimate, or null if truly unknowable)",
  "resolution_criteria": "Specific description of what triggers resolution, e.g. 'When the Associated Press calls the election' or 'When the interview airs and transcript is available'",
  "outcomes": [
    { "outcome_id": "snake_case_id", "label": "Human readable label", "prior_probability": 0.X }
  ],
  "x_rule_templates": ["keyword1 OR keyword2", "#hashtag", "@handle"]
}

Rules:
- outcome_id should be snake_case, short, descriptive
- prior_probability values must sum to exactly 1.0
- Include an "other" outcome if the question allows for unexpected results
- x_rule_templates should be valid X API v2 filtered stream rules
- Keep outcomes between 2-5 options
- Be specific and realistic about resolution dates`;

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
        { role: "user", content: `Create a prediction market for: "${question}"` }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No content in Grok response");
  }

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  const parsed = JSON.parse(jsonStr.trim());
  return MarketCreationResponseSchema.parse(parsed);
}

export async function checkMarketResolution(
  question: string,
  normalizedQuestion: string,
  resolutionCriteria: string,
  outcomes: Array<{ outcome_id: string; label: string }>
): Promise<ResolutionCheckResponse> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY not configured");
  }

  const today = new Date().toISOString().split("T")[0];
  const outcomesStr = outcomes.map((o) => `- ${o.outcome_id}: "${o.label}"`).join("\n");

  const systemPrompt = `You are a prediction market resolution assistant with real-time knowledge. Today's date is ${today}.

Your job is to determine if a prediction market question can now be definitively resolved based on real-world events that have occurred.

You have access to current information about world events. Use your knowledge to determine:
1. Whether the resolution criteria have been met
2. Which outcome won (if resolvable)
3. Your confidence level

IMPORTANT: Only resolve if you are CERTAIN of the outcome. If the event hasn't happened yet or results aren't official, DO NOT resolve.

Output ONLY valid JSON:
{
  "should_resolve": true/false,
  "winning_outcome_id": "outcome_id of winner or null if not resolvable",
  "confidence": 0.0-1.0 (only resolve if >= 0.95),
  "resolution_summary": "Brief explanation of what happened and why this outcome won",
  "source_description": "What source/event confirms this (e.g. 'AP called the election', 'Official press release', 'Event concluded')"
}

If should_resolve is false, set winning_outcome_id to null and explain why in resolution_summary.`;

  const userPrompt = `Check if this market can be resolved:

Question: ${question}
Normalized: ${normalizedQuestion}
Resolution Criteria: ${resolutionCriteria}

Possible Outcomes:
${outcomesStr}

Can this market be definitively resolved now based on real-world events?`;

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
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No content in Grok response");
  }

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  const parsed = JSON.parse(jsonStr.trim());
  return ResolutionCheckResponseSchema.parse(parsed);
}

export async function checkSemanticSimilarity(
  newQuestion: string,
  existingQuestions: { id: string; question: string; normalized_question: string | null }[]
): Promise<{ isSimilar: boolean; matchedMarketId: string | null; reasoning: string }> {
  if (existingQuestions.length === 0) {
    return { isSimilar: false, matchedMarketId: null, reasoning: "No existing markets to compare" };
  }

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    const lowerNew = newQuestion.toLowerCase();
    for (const eq of existingQuestions) {
      const lowerExisting = eq.question.toLowerCase();
      const lowerNormalized = eq.normalized_question?.toLowerCase() ?? "";
      const newWords = new Set(lowerNew.split(/\s+/).filter((w) => w.length > 3));
      const existingWords = new Set([...lowerExisting.split(/\s+/), ...lowerNormalized.split(/\s+/)].filter((w) => w.length > 3));
      const overlap = [...newWords].filter((w) => existingWords.has(w)).length;
      if (overlap >= 3) {
        return { isSimilar: true, matchedMarketId: eq.id, reasoning: "Keyword overlap detected" };
      }
    }
    return { isSimilar: false, matchedMarketId: null, reasoning: "No keyword overlap" };
  }

  const systemPrompt = `You are a semantic similarity checker for prediction markets. Given a new question and a list of existing markets, determine if the new question is asking essentially the same thing as any existing market (even if worded differently).

Output ONLY valid JSON:
{
  "is_similar": true/false,
  "matched_market_id": "id of most similar market or null",
  "similarity_score": 0.0-1.0,
  "reasoning": "Brief explanation"
}

Consider questions similar if they:
- Ask about the same event/outcome (even with different wording)
- Would be resolved by the same real-world outcome
- Cover overlapping time periods for the same topic

Consider questions different if they:
- Ask about different time periods (2024 vs 2028 election)
- Ask about fundamentally different aspects of a topic
- Would be resolved independently`;

  const existingList = existingQuestions
    .map((eq) => `- ID: ${eq.id}\n  Question: ${eq.question}\n  Normalized: ${eq.normalized_question ?? "n/a"}`)
    .join("\n\n");

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
        {
          role: "user",
          content: `New question: "${newQuestion}"\n\nExisting markets:\n${existingList}`
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    return { isSimilar: false, matchedMarketId: null, reasoning: "API error, skipping similarity check" };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    return { isSimilar: false, matchedMarketId: null, reasoning: "No response from similarity check" };
  }

  try {
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());
    const validated = SimilarityCheckResponseSchema.parse(parsed);

    return {
      isSimilar: validated.is_similar && validated.similarity_score >= 0.7,
      matchedMarketId: validated.is_similar ? parsed.matched_market_id : null,
      reasoning: validated.reasoning
    };
  } catch {
    return { isSimilar: false, matchedMarketId: null, reasoning: "Failed to parse similarity response" };
  }
}
