import { z } from "zod";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const MarketCreationResponseSchema = z.object({
  normalized_question: z.string(),
  resolution_date: z.string().nullable().optional(),
  resolution_reason: z.string().nullable().optional(),
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

  const systemPrompt = `You are a prediction market creation assistant. Given a user question about a future event, you must:

1. Normalize the question into a clear, unambiguous canonical form
2. Determine a reasonable resolution date (when we'll know the answer)
3. Generate 2-5 mutually exclusive, collectively exhaustive outcomes
4. Assign prior probabilities that sum to 1.0
5. Generate X (Twitter) filtered stream rule templates to capture relevant posts

Output ONLY valid JSON with this exact structure:
{
  "normalized_question": "Clear canonical question ending with ?",
  "resolution_date": "YYYY-MM-DD or null if unclear",
  "resolution_reason": "Brief explanation of why this date",
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
- Be specific in the normalized question (include year, context)`;

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

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  const parsed = JSON.parse(jsonStr.trim());
  return MarketCreationResponseSchema.parse(parsed);
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
    // Fallback to basic keyword matching if no API key
    const lowerNew = newQuestion.toLowerCase();
    for (const eq of existingQuestions) {
      const lowerExisting = eq.question.toLowerCase();
      const lowerNormalized = eq.normalized_question?.toLowerCase() ?? "";
      // Simple overlap check
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
    // Fallback on error
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

