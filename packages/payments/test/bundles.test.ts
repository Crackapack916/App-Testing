import { describe, expect, it } from "vitest";
import { BUNDLES } from "../src";

// The working test ladder (brief item 9, default_price_ladder in 0022_sets_drops_videos.sql):
// 1 pack at 1,000 credits, 3 at 950 each, 6 at 900 each.
const LADDER: [number, number][] = [[1, 1000], [3, 950], [6, 900]];

describe("bundles", () => {
  it("each bundle buys exactly one tier of the pack ladder", () => {
    for (const b of BUNDLES) {
      const tier = [...LADDER].reverse().find(([minQty]) => minQty <= b.packs)!;
      expect(b.credits).toBe(tier[1] * b.packs);
    }
    expect(BUNDLES.map((b) => b.credits)).toEqual([1000, 2850, 5400]);
  });
});
