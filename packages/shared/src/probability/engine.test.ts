import { describe, expect, it } from "vitest";
import { computeProbabilitiesV1, type PostInput, type OutcomeInput } from "./engine";

const baseOutcomes: OutcomeInput[] = [
  { id: "o1", label: "A", prior_probability: 0.5 },
  { id: "o2", label: "B", prior_probability: 0.5 }
];

const now = Date.now();

function makePost(partial: Partial<PostInput>): PostInput {
  return {
    id: partial.id ?? "p1",
    created_at_ms: partial.created_at_ms ?? now,
    author_id: partial.author_id ?? "auth",
    author_followers: partial.author_followers ?? 1000,
    author_verified: partial.author_verified ?? false,
    scores: partial.scores ?? {
      o1: { relevance: 0.6, stance: 0.8, strength: 0.6, credibility: 0.6 },
      o2: { relevance: 0.6, stance: -0.8, strength: 0.6, credibility: 0.6 }
    },
    initial_metrics: partial.initial_metrics,
    features: partial.features,
    author_created_at_ms: partial.author_created_at_ms,
    text: partial.text
  };
}

describe("computeProbabilitiesV1", () => {
  it("keeps priors when no posts accepted", () => {
    const result = computeProbabilitiesV1({
      now_ms: now,
      outcomes: baseOutcomes,
      posts: [
        makePost({
          id: "old",
          created_at_ms: now - 80 * 3600 * 1000, // beyond 72h
          scores: {
            o1: { relevance: 1, stance: 1, strength: 1, credibility: 1 },
            o2: { relevance: 1, stance: -1, strength: 1, credibility: 1 }
          }
        })
      ]
    });
    expect(result.probabilities.o1).toBeCloseTo(0.5, 3);
    expect(result.notes.accepted_posts).toBe(0);
  });

  it("moves probability toward evidence with small batch", () => {
    const result = computeProbabilitiesV1({
      now_ms: now,
      outcomes: baseOutcomes,
      posts: [makePost({ id: "p-strong" })]
    });
    expect(result.probabilities.o1).toBeGreaterThan(0.5);
    expect(result.probabilities.o2).toBeLessThan(0.5);
  });

  it("applies author dilution for repeated posts", () => {
    const posts = ["p1", "p2", "p3"].map((id, idx) =>
      makePost({
        id,
        author_id: "same",
        created_at_ms: now - idx * 60_000
      })
    );
    const result = computeProbabilitiesV1({ now_ms: now, outcomes: baseOutcomes, posts });
    expect(result.notes.accepted_posts).toBeGreaterThan(0);
    expect(result.notes.Wbatch).toBeLessThan(3); // diluted compared to linear
  });

  it("rejects very low-quality posts after grace window", () => {
    const bad = makePost({
      id: "bad",
      created_at_ms: now - 20 * 60 * 1000, // 20m age
      scores: {
        o1: { relevance: 0.05, stance: 0.1, strength: 0.1, credibility: 0.05 },
        o2: { relevance: 0.05, stance: -0.1, strength: 0.1, credibility: 0.05 }
      }
    });
    const result = computeProbabilitiesV1({ now_ms: now, outcomes: baseOutcomes, posts: [bad] });
    expect(result.notes.accepted_posts).toBe(0);
    expect(result.probabilities.o1).toBeCloseTo(0.5, 3);
  });
});

