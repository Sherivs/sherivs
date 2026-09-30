/**
 * CoreGrid Scholar — Phase 14 Data Platform unit tests (data-quality).
 *
 * Validates:
 * - Quality rule creation and evaluation (AD).
 * - Quality scoring across dimensions (AE).
 * - Quarantine of invalid records (AF, AG).
 * - Idempotent replay and deduplication (AH, AI).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createQualityRule,
  evaluateQualityRule,
  computeQualityScore,
  quarantineRecord,
  replayDeduplicationCheck,
  isDeduplicated,
  type ReplayState,
} from "@/lib/data-quality";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

describe("Quality rules (AD)", () => {
  it("enforces required-field rules", () => {
    const rule = createQualityRule({
      tenantId: TENANT_A,
      datasetName: "d",
      kind: "required_field",
      field: "student_id",
    });
    if (!rule.ok) throw new Error("fixture failed");
    expect(evaluateQualityRule(rule.rule, { student_id: "s1" }).satisfied).toBe(true);
    expect(evaluateQualityRule(rule.rule, { student_id: "" }).satisfied).toBe(false);
  });

  it("enforces tenant_id presence", () => {
    const rule = createQualityRule({
      tenantId: TENANT_A,
      datasetName: "d",
      kind: "tenant_id_present",
      field: "tenant_id",
    });
    if (!rule.ok) throw new Error("fixture failed");
    expect(evaluateQualityRule(rule.rule, { tenant_id: "tenant-a" }).satisfied).toBe(true);
    expect(evaluateQualityRule(rule.rule, {}).satisfied).toBe(false);
  });

  it("enforces non-negative amounts", () => {
    const rule = createQualityRule({
      tenantId: TENANT_A,
      datasetName: "d",
      kind: "non_negative",
      field: "amount",
    });
    if (!rule.ok) throw new Error("fixture failed");
    expect(evaluateQualityRule(rule.rule, { amount: 100 }).satisfied).toBe(true);
    expect(evaluateQualityRule(rule.rule, { amount: -5 }).satisfied).toBe(false);
  });

  it("enforces valid enums", () => {
    const rule = createQualityRule({
      tenantId: TENANT_A,
      datasetName: "d",
      kind: "valid_enum",
      field: "currency",
      params: { allowed: "NGN,USD" },
    });
    if (!rule.ok) throw new Error("fixture failed");
    expect(evaluateQualityRule(rule.rule, { currency: "NGN" }).satisfied).toBe(true);
    expect(evaluateQualityRule(rule.rule, { currency: "XXX" }).satisfied).toBe(false);
  });

  it("enforces valid timestamps", () => {
    const rule = createQualityRule({
      tenantId: TENANT_A,
      datasetName: "d",
      kind: "valid_timestamp",
      field: "occurred_at",
    });
    if (!rule.ok) throw new Error("fixture failed");
    expect(evaluateQualityRule(rule.rule, { occurred_at: "2026-01-01T00:00:00Z" }).satisfied).toBe(
      true,
    );
    expect(evaluateQualityRule(rule.rule, { occurred_at: "not-a-date" }).satisfied).toBe(false);
  });
});

describe("Quality score (AE)", () => {
  it("computes an overall score across dimensions", () => {
    const score = computeQualityScore({
      datasetName: "d",
      tenantId: TENANT_A,
      completeness: 90,
      validity: 95,
      freshness: 80,
      uniqueness: 100,
      consistency: 85,
      now: NOW,
    });
    expect(score.overallScore).toBe(90); // (90+95+80+100+85)/5
  });
});

describe("Quarantine (AF, AG)", () => {
  it("quarantines invalid records — never silently discards them", () => {
    const result = quarantineRecord({
      tenantId: TENANT_A,
      record: { student_id: "" },
      reason: "Missing required field",
      source: "sis-import",
      pipeline: "pipeline-1",
      validationFailure: "student_id is required",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quarantined.retryStatus).toBe("none");
      expect(result.quarantined.pipeline).toBe("pipeline-1");
    }
  });

  it("rejects a quarantine without a reason", () => {
    const result = quarantineRecord({
      tenantId: TENANT_A,
      record: {},
      reason: "",
      source: "s",
      pipeline: "p",
      validationFailure: "f",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Replay and deduplication (AH, AI)", () => {
  it("replay is idempotent — the same key never produces duplicate effects", () => {
    const state: ReplayState = { processedKeys: new Set() };
    expect(replayDeduplicationCheck("event-1", state).outcome).toBe("proceed");
    expect(replayDeduplicationCheck("event-1", state).outcome).toBe("duplicate");
    expect(isDeduplicated("event-1", state)).toBe(true);
  });
});
