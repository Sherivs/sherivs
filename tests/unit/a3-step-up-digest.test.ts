import { describe, expect, it } from "vitest";
import { agentPromotionDigest, stepUpDigest } from "../../frontend/src/lib/workflow/step-up-digest";

const A = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";

describe("step-up digest", () => {
  it("matches the value the database computes for the same promotion", () => {
    // Same vector as tests/integration/a3-sensitive-step-up.local.sql (computed there by wf_step_up_digest and by node).
    expect(
      agentPromotionDigest({ orgId: A, agentRef: "ledger", toLevel: "draft", evidenceId: E }),
    ).toBe("e3fc9ac43e968fb9ce45297bd24ca2bfc758a0044078812c9e4888295147c866");
  });
  it("changes with the kind and with every part, and is not fooled by moving a boundary", () => {
    const base = stepUpDigest("agent_promotion", ["o", "a", "draft", "e"]);
    expect(stepUpDigest("production_change", ["o", "a", "draft", "e"])).not.toBe(base);
    expect(stepUpDigest("agent_promotion", ["o", "a", "draft", "f"])).not.toBe(base);
    expect(stepUpDigest("agent_promotion", ["o", "ad", "raft", "e"])).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a part that contains the separator", () => {
    expect(() => stepUpDigest("agent_promotion", ["a\u001fb"])).toThrow();
  });
});
