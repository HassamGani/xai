import { describe, expect, it } from "vitest";
import { rankTopMovers, type MarketProbabilitySnapshot } from "./qa";

describe("rankTopMovers", () => {
  const current: MarketProbabilitySnapshot[] = [
    { market_id: "a", probabilities: { yes: 0.8 }, timestamp: "" },
    { market_id: "b", probabilities: { up: 0.4 }, timestamp: "" }
  ];
  const baseline: MarketProbabilitySnapshot[] = [
    { market_id: "a", probabilities: { yes: 0.5 }, timestamp: "" },
    { market_id: "b", probabilities: { up: 0.6 }, timestamp: "" }
  ];

  it("orders by absolute delta", () => {
    const ranked = rankTopMovers(current, baseline, 2);
    expect(ranked[0].market_id).toBe("a"); // +0.3 change
    expect(ranked[0].delta).toBeCloseTo(0.3, 3);
    expect(ranked[1].market_id).toBe("b");
  });

  it("falls back to current when baseline missing", () => {
    const ranked = rankTopMovers(current, [], 1);
    expect(ranked[0].from).toBeCloseTo(0.8, 3);
    expect(ranked[0].delta).toBeCloseTo(0, 3);
  });
});
