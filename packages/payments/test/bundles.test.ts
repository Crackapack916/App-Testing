import { describe, expect, it } from "vitest";
import { BUNDLES } from "../src";
import { LADDER } from "../../db/test/fixtures";

describe("bundles", () => {
  it("each bundle buys exactly one tier of the pack ladder", () => {
    for (const b of BUNDLES) {
      const tier = [...LADDER].reverse().find(([minQty]) => minQty <= b.packs)!;
      expect(b.credits).toBe(tier[1] * b.packs);
    }
  });
});
