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

describe("support write digest (SUP-01)", () => {
  it("matches wf_step_up_digest('support_write', ARRAY[grant]) and differs per grant", async () => {
    const { supportWriteDigest } = await import("../../frontend/src/lib/workflow/step-up-digest");
    const g1 = "44444444-4444-4444-8444-444444444444";
    const g2 = "55555555-5555-4555-8555-555555555555";
    expect(supportWriteDigest(g1)).toMatch(/^[0-9a-f]{64}$/);
    expect(supportWriteDigest(g1)).toBe(stepUpDigest("support_write", [g1]));
    expect(supportWriteDigest(g1)).not.toBe(supportWriteDigest(g2));
  });
});
