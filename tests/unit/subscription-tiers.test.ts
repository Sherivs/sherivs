import { describe, expect, it } from "vitest";
import {
  ALL_TIERS,
  hasTierFeature,
  isFeatureActive,
  SUBSCRIPTION_TIERS,
  type FeatureKey,
} from "../../frontend/src/lib/subscription-tiers";

describe("subscription tier feature access", () => {
  it("keeps all features unlocked regardless of the tier", () => {
    expect(hasTierFeature("trial", "bus_live_tracking")).toBe(true);
    expect(hasTierFeature("growth", "ai_timetable")).toBe(true);
    expect(hasTierFeature("starter", "digital_twin")).toBe(true);
  });

  it("treats feature activity as globally enabled when the school is unlocked", () => {
    expect(isFeatureActive("trial", {}, "bus_live_tracking")).toBe(true);
    expect(isFeatureActive("growth", { bus_live_tracking: false }, "bus_live_tracking")).toBe(true);
    expect(isFeatureActive("starter", { digital_twin: false }, "digital_twin")).toBe(true);
  });
});

/**
 * MISSION-R-73 (J-044) — schools.active_features coupling kill.
 * The legacy school-column override must be provably a DEAD INPUT to the
 * access decision for every tier × feature combination: an explicit
 * `false` override and an explicit `true` override must yield the same
 * decision, because the canonical decision surface is the feature gate
 * (scholar-feature-access.functions.ts), not the school row.
 */
describe("schools.active_features coupling is dead (MISSION-R-73)", () => {
  const featureKeys = Object.keys(SUBSCRIPTION_TIERS.enterprise.features) as FeatureKey[];

  it("cannot be influenced by an explicit false school override, for every tier and feature", () => {
    for (const tier of ALL_TIERS) {
      for (const feature of featureKeys) {
        expect(isFeatureActive(tier, { [feature]: false }, feature)).toBe(true);
      }
    }
  });

  it("is indifferent to the override value — false and true decide identically", () => {
    for (const tier of ALL_TIERS) {
      for (const feature of featureKeys) {
        const withFalse = isFeatureActive(tier, { [feature]: false }, feature);
        const withTrue = isFeatureActive(tier, { [feature]: true }, feature);
        expect(withFalse).toBe(withTrue);
      }
    }
  });

  it("is indifferent to the column being absent, null or garbage", () => {
    for (const tier of ALL_TIERS) {
      expect(isFeatureActive(tier, undefined, "bus_live_tracking")).toBe(true);
      expect(isFeatureActive(tier, null, "bus_live_tracking")).toBe(true);
    }
  });
});
