import { describe, expect, it } from "vitest";
import { MarketQaIntentSchema, marketQaIntentPrompt } from "./marketQa";

describe("MarketQaIntentSchema", () => {
  it("fills defaults for limit and window", () => {
    const parsed = MarketQaIntentSchema.parse({
      intent: "top_movers",
      topics: ["elections"]
    });
    expect(parsed.time_window_days).toBe(7);
    expect(parsed.limit).toBe(5);
  });

  it("rejects invalid intent", () => {
    expect(() =>
      MarketQaIntentSchema.parse({
        intent: "unknown",
        topics: []
      })
    ).toThrow();
  });
});

describe("marketQaIntentPrompt", () => {
  it("mentions intents and JSON expectation", () => {
    const prompt = marketQaIntentPrompt("2024-01-01");
    expect(prompt).toContain("top_movers");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("Today's date");
  });
});
