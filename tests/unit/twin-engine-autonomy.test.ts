/**
 * ENGINE-01 — earned-autonomy ladder. Seeded property tests; fully deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  DEMOTE_BELOW_PASS_RATE,
  EVIDENCE_MAX_AGE_MS,
  PROMOTION_BAR,
  TRUST_STATES,
  applyEvidence,
  effectiveAutonomy,
  initialTrust,
  resetToShadow,
  type EvalEvidence,
  type TrustRecord,
  type TrustState,
} from "../../frontend/src/lib/twin-engine/autonomy-ladder";

const NOW = 2_000_000_000_000;
const good = (samples = 500, passRate = 0.99): EvalEvidence => ({
  samples,
  passRate,
  regressions: 0,
  evaluatedAtMs: NOW - 1000,
});
const rec = (state: TrustState, sheriffPromotionId?: string): TrustRecord =>
  sheriffPromotionId === undefined
    ? { capabilityId: "c", state }
    : { capabilityId: "c", state, sheriffPromotionId };

const T0 = { tier: "T0", autonomy: "act_autonomously" } as const;
const T1 = { tier: "T1", autonomy: "act_autonomously" } as const;
const T2 = { tier: "T2", autonomy: "act_with_approval", promotableToAutonomous: true } as const;
const T2fixed = { tier: "T2", autonomy: "act_with_approval" } as const;
const T3 = { tier: "T3", autonomy: "act_with_approval" } as const;

describe("effective autonomy", () => {
  it("no record means shadow: nothing executes", () => {
    expect(effectiveAutonomy(T0, undefined)).toBe("shadow");
  });
  it("is the lower of the pack declaration and the earned state", () => {
    expect(effectiveAutonomy(T0, rec("shadow"))).toBe("shadow");
    expect(effectiveAutonomy(T0, rec("propose"))).toBe("propose_only");
    expect(effectiveAutonomy(T0, rec("assist"))).toBe("act_with_approval");
    expect(effectiveAutonomy(T0, rec("autonomous"))).toBe("act_autonomously");
    expect(effectiveAutonomy({ tier: "T1", autonomy: "propose_only" }, rec("autonomous"))).toBe(
      "propose_only",
    );
  });
  it("T3 is capped at approval and T4 never leaves shadow", () => {
    expect(effectiveAutonomy(T3, rec("autonomous"))).toBe("act_with_approval");
    expect(effectiveAutonomy({ tier: "T4", autonomy: "act_autonomously" }, rec("autonomous"))).toBe(
      "shadow",
    );
  });
  it("T2 is autonomous only when promotable, autonomous AND sheriff-promoted", () => {
    expect(effectiveAutonomy(T2, rec("autonomous"))).toBe("act_with_approval");
    expect(effectiveAutonomy(T2, rec("autonomous", "p1"))).toBe("act_autonomously");
    expect(effectiveAutonomy(T2fixed, rec("autonomous", "p1"))).toBe("act_with_approval");
    expect(effectiveAutonomy(T2, rec("assist", "p1"))).toBe("act_with_approval");
    expect(
      effectiveAutonomy(
        { tier: "T2", autonomy: "propose_only", promotableToAutonomous: true },
        rec("autonomous", "p1"),
      ),
    ).toBe("propose_only");
  });
  it("a new agent starts with every capability in shadow", () => {
    for (const r of initialTrust(["a.b", "c.d"])) expect(r.state).toBe("shadow");
  });
  it("reset returns to shadow and drops the promotion", () => {
    expect(resetToShadow(rec("autonomous", "p1"))).toEqual({ capabilityId: "c", state: "shadow" });
  });
});

describe("applying evidence", () => {
  it("promotes one rung when fresh evidence clears the bar", () => {
    const r = applyEvidence(
      T0,
      rec("shadow"),
      good(PROMOTION_BAR.propose.samples, PROMOTION_BAR.propose.passRate),
      NOW,
    );
    expect(r).toMatchObject({ changed: true, reason: "promoted", record: { state: "propose" } });
  });
  it("never skips a rung however strong the evidence", () => {
    const r = applyEvidence(T0, rec("shadow"), good(100000, 1), NOW);
    expect(r.record.state).toBe("propose");
  });
  it("refuses stale, future-dated or thin evidence", () => {
    const stale = { ...good(), evaluatedAtMs: NOW - EVIDENCE_MAX_AGE_MS - 1 };
    expect(applyEvidence(T0, rec("shadow"), stale, NOW)).toMatchObject({
      changed: false,
      reason: "evidence_stale_or_invalid",
    });
    const future = { ...good(), evaluatedAtMs: NOW + 5 };
    expect(applyEvidence(T0, rec("shadow"), future, NOW)).toMatchObject({ changed: false });
    expect(applyEvidence(T0, rec("shadow"), good(5, 1), NOW)).toMatchObject({
      changed: false,
      reason: "evidence_below_bar",
    });
  });
  it("demotes at once on any regression or a low pass rate, one rung", () => {
    const reg = applyEvidence(T0, rec("autonomous"), { ...good(), regressions: 1 }, NOW);
    expect(reg).toMatchObject({ changed: true, reason: "regression", record: { state: "assist" } });
    const low = applyEvidence(T0, rec("assist"), good(500, DEMOTE_BELOW_PASS_RATE - 0.01), NOW);
    expect(low).toMatchObject({
      changed: true,
      reason: "pass_rate_below_floor",
      record: { state: "propose" },
    });
    expect(applyEvidence(T0, rec("shadow"), { ...good(), regressions: 3 }, NOW)).toMatchObject({
      changed: false,
      reason: "already_shadow",
    });
  });
  it("demotion drops a sheriff promotion", () => {
    const r = applyEvidence(T2, rec("autonomous", "p1"), { ...good(), regressions: 1 }, NOW);
    expect(r.record.sheriffPromotionId).toBeUndefined();
    expect(r.record.state).toBe("assist");
  });
  it("T3 never reaches autonomous", () => {
    expect(applyEvidence(T3, rec("assist"), good(100000, 1), NOW)).toMatchObject({
      changed: false,
      reason: "t3_never_autonomous",
    });
  });
  it("T2 needs the pack's promotable flag and a sheriff promotion", () => {
    expect(applyEvidence(T2fixed, rec("assist", "p1"), good(100000, 1), NOW)).toMatchObject({
      reason: "t2_not_promotable",
    });
    expect(applyEvidence(T2, rec("assist"), good(100000, 1), NOW)).toMatchObject({
      reason: "t2_needs_sheriff_promotion",
    });
    expect(applyEvidence(T2, rec("assist", "p1"), good(100000, 1), NOW)).toMatchObject({
      changed: true,
      record: { state: "autonomous" },
    });
  });
  it("the top rung stays put", () => {
    expect(applyEvidence(T0, rec("autonomous"), good(), NOW)).toMatchObject({
      changed: false,
      reason: "at_top",
    });
  });
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("ladder invariants hold under random evidence (property)", () => {
  const caps = [T0, T1, T2, T2fixed, T3] as const;
  it("never skips up a rung, never lets T3 reach autonomous, T2 only when promoted", () => {
    const rand = rng(20261114);
    for (let run = 0; run < 400; run++) {
      const cap = caps[Math.floor(rand() * caps.length)] as (typeof caps)[number];
      let record = rec("shadow", rand() < 0.5 ? "promo" : undefined);
      for (let step = 0; step < 40; step++) {
        const ev: EvalEvidence = {
          samples: Math.floor(rand() * 400),
          passRate: 0.85 + rand() * 0.15,
          regressions: rand() < 0.1 ? 1 : 0,
          evaluatedAtMs: NOW - Math.floor(rand() * (EVIDENCE_MAX_AGE_MS * 1.5)),
        };
        const before = TRUST_STATES.indexOf(record.state);
        const out = applyEvidence(cap, record, ev, NOW);
        const after = TRUST_STATES.indexOf(out.record.state);
        expect(after).toBeLessThanOrEqual(before + 1);
        if (cap.tier === "T3") expect(out.record.state).not.toBe("autonomous");
        if (cap.tier === "T2" && out.record.state === "autonomous") {
          expect(out.record.sheriffPromotionId).toBeDefined();
          expect((cap as { promotableToAutonomous?: boolean }).promotableToAutonomous).toBe(true);
        }
        const eff = effectiveAutonomy(cap, out.record);
        if (
          cap.tier === "T3" ||
          (cap.tier === "T2" && out.record.sheriffPromotionId === undefined)
        ) {
          expect(eff).not.toBe("act_autonomously");
        }
        record = out.record;
      }
    }
  });
});
