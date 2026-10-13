/**
 * CoreGrid — Hermes FINDING → JarvisObservation translator tests.
 *
 * Proves the honesty law with injected stamps (no network, no Hermes cycle):
 * empty/invalid input never synthesizes a finding; only mission_stuck and
 * worker_quarantined map onto DETECTABLE_CONDITIONS; other kinds stay
 * Hermes-prefixed briefing-only kinds; claimClass is never VERIFIED or
 * EXECUTED; findings without evidence are not a stamp.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JarvisCapability } from "@/lib/jarvis/jarvis-contract";
import {
  DETECTABLE_CONDITIONS,
  runJarvisEnterpriseCycle,
} from "@/lib/jarvis/enterprise-loop";
import {
  HERMES_FINDING_KINDS,
  HERMES_FINDING_OBSERVATION_SOURCE,
  stampHermesFindings,
  type HermesFindingObservationSource,
} from "@/lib/hermes/hermes-finding-observation";

const TENANT = "tenant-alpha";
const OTHER_TENANT = "tenant-beta";
const NOW = "2026-10-13T08:00:00.000Z";
const GRANTED = Object.values(JarvisCapability);
const MODULE_SRC = join(process.cwd(), "frontend/src/lib/hermes/hermes-finding-observation.ts");

function finding(
  partial: Partial<HermesFindingObservationSource> &
    Pick<HermesFindingObservationSource, "kind">,
): HermesFindingObservationSource {
  const kind = partial.kind;
  return {
    findingId: `${kind}:subject-1`,
    tenantId: TENANT,
    subjectRef: "subject-1",
    severity: "warning",
    summary: `${kind} observed`,
    evidenceRefs: ["ev-1"],
    observedAt: NOW,
    claim: {
      source: "mission_record_port",
      sourceRef: "cg_mission_execution:subject-1",
      observedAt: NOW,
      verified: true,
      confidence: "canonical",
      claim: "state of record",
    },
    ...partial,
    kind,
  };
}

function stamp(
  findings: readonly HermesFindingObservationSource[],
  tenantRef: string = TENANT,
) {
  return stampHermesFindings({ tenantRef, findings });
}

describe("Hermes finding observation stamps — honesty law", () => {
  it("empty findings → no observations", () => {
    expect(stamp([])).toEqual([]);
    expect(HERMES_FINDING_OBSERVATION_SOURCE).toBe("hermes-finding");
    expect(HERMES_FINDING_KINDS).toEqual([
      "mission_stuck",
      "mission_failed",
      "mission_denied",
      "evidence_unverified",
      "worker_quarantined",
      "worker_suspended",
    ]);
  });

  it("blank tenant → empty", () => {
    const findings = [finding({ kind: "mission_stuck" })];
    expect(stampHermesFindings({ tenantRef: "", findings })).toEqual([]);
    expect(stampHermesFindings({ tenantRef: "   ", findings })).toEqual([]);
  });

  it("cross-tenant finding skipped", () => {
    const observations = stamp([
      finding({ kind: "mission_stuck", tenantId: OTHER_TENANT, findingId: "mission_stuck:foreign" }),
      finding({ kind: "mission_stuck", findingId: "mission_stuck:local" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.observationId).toBe("hermes-finding:mission_stuck:local");
    expect(observations[0]?.tenantRef).toBe(TENANT);
  });

  it("empty evidenceRefs skipped", () => {
    const observations = stamp([
      finding({ kind: "mission_stuck", evidenceRefs: [] }),
      finding({ kind: "mission_stuck", evidenceRefs: ["", "   "] }),
      finding({
        kind: "mission_stuck",
        evidenceRefs: undefined as unknown as readonly string[],
      }),
      finding({ kind: "mission_stuck", findingId: "mission_stuck:with-evidence" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.observationId).toBe("hermes-finding:mission_stuck:with-evidence");
    expect(observations[0]?.evidenceRef).toBe("ev-1");
  });

  it("unknown kind skipped", () => {
    const observations = stamp([
      finding({ kind: "mysterious_blip" }),
      finding({ kind: "provider_outage" }),
      finding({ kind: "test_regression" }),
      finding({ kind: "mission_stuck", findingId: "mission_stuck:known" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("mission_timeout");
    expect(observations[0]?.observationId).toBe("hermes-finding:mission_stuck:known");
  });

  it("skips blank findingId, subjectRef, summary, observedAt, and invalid severity", () => {
    const observations = stamp([
      finding({ kind: "mission_stuck", findingId: "" }),
      finding({ kind: "mission_stuck", findingId: "   " }),
      finding({ kind: "mission_stuck", subjectRef: "" }),
      finding({ kind: "mission_stuck", summary: "   " }),
      finding({ kind: "mission_stuck", observedAt: "" }),
      finding({
        kind: "mission_stuck",
        severity: "fatal" as HermesFindingObservationSource["severity"],
      }),
      finding({ kind: "mission_stuck", findingId: "mission_stuck:ok", severity: "info" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.observationId).toBe("hermes-finding:mission_stuck:ok");
    expect(observations[0]?.severity).toBe("info");
  });

  it("mission_stuck + evidence → kind mission_timeout, claimClass OBSERVED; cycle detects mission_timeout", () => {
    const observedAt = "2026-10-13T08:02:00.000Z";
    const observations = stamp([
      finding({
        kind: "mission_stuck",
        findingId: "mission_stuck:exec-9",
        subjectRef: "exec-9",
        summary: "assigned execution exec-9 is stale",
        evidenceRefs: ["  ", "cg_foundation_evidence:exec-9"],
        observedAt,
        severity: "warning",
      }),
    ]);
    expect(observations).toHaveLength(1);
    const observation = observations[0];
    expect(observation?.kind).toBe("mission_timeout");
    expect(observation?.claimClass).toBe("OBSERVED");
    expect(observation?.claimClass).not.toBe("VERIFIED");
    expect(observation?.claimClass).not.toBe("EXECUTED");
    expect(observation?.observationId).toBe("hermes-finding:mission_stuck:exec-9");
    expect(observation?.evidenceRef).toBe("cg_foundation_evidence:exec-9");
    expect(observation?.at).toBe(observedAt);
    expect(observation?.tenantRef).toBe(TENANT);
    expect(observation?.summary).toBe("assigned execution exec-9 is stale");
    expect(observation?.severity).toBe("warning");
    expect(DETECTABLE_CONDITIONS).toContain("mission_timeout");

    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]?.condition).toBe("mission_timeout");
    expect(result.detections[0]?.claim.claimClass).toBe("OBSERVED");
  });

  it("worker_quarantined → worker_failure; cycle detects worker_failure", () => {
    const observations = stamp([
      finding({
        kind: "worker_quarantined",
        findingId: "worker_quarantined:worker-7",
        subjectRef: "worker-7",
        summary: "worker worker-7 quarantined after repeated failures",
        severity: "critical",
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("worker_failure");
    expect(observations[0]?.claimClass).toBe("OBSERVED");
    expect(DETECTABLE_CONDITIONS).toContain("worker_failure");

    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]?.condition).toBe("worker_failure");
    expect(result.detections[0]?.claim.claimClass).toBe("OBSERVED");
  });

  it("mission_failed → hermes_mission_failed; cycle has ZERO detections (briefing may restate summary)", () => {
    const summary = "mission exec-4 failed its lawful path";
    const observations = stamp([
      finding({
        kind: "mission_failed",
        findingId: "mission_failed:exec-4",
        subjectRef: "exec-4",
        summary,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("hermes_mission_failed");
    expect(observations[0]?.kind).not.toBe("mission_timeout");
    expect(DETECTABLE_CONDITIONS).not.toContain("hermes_mission_failed");

    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toEqual([]);
    expect(result.missionProposals).toEqual([]);
    expect(result.briefing?.lines.some((line) => line.summary === summary)).toBe(true);
  });

  it("evidence_unverified does NOT become test_regression or VERIFIED", () => {
    const observations = stamp([
      finding({
        kind: "evidence_unverified",
        findingId: "evidence_unverified:exec-2",
        subjectRef: "exec-2",
        summary: "verification record for exec-2 is inconclusive",
        claim: {
          source: "verification_port",
          sourceRef: "cg_foundation_evidence:exec-2",
          observedAt: NOW,
          verified: true,
          confidence: "canonical",
          claim: "verification decision recorded",
        },
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("hermes_evidence_unverified");
    expect(observations[0]?.kind).not.toBe("test_regression");
    expect(observations[0]?.claimClass).toBe("OBSERVED");
    expect(observations[0]?.claimClass).not.toBe("VERIFIED");
    expect(DETECTABLE_CONDITIONS).not.toContain("hermes_evidence_unverified");
    expect(DETECTABLE_CONDITIONS).not.toContain(observations[0]?.kind);

    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toEqual([]);
    expect(result.claims.every((claim) => claim.claimClass !== "VERIFIED")).toBe(true);
  });

  it("mission_denied and worker_suspended stay Hermes-prefixed and are not detectable", () => {
    const observations = stamp([
      finding({ kind: "mission_denied", findingId: "mission_denied:exec-1", summary: "denied" }),
      finding({
        kind: "worker_suspended",
        findingId: "worker_suspended:worker-3",
        summary: "suspended",
      }),
    ]);
    expect(observations.map((item) => item.kind)).toEqual([
      "hermes_mission_denied",
      "hermes_worker_suspended",
    ]);
    for (const observation of observations) {
      expect(DETECTABLE_CONDITIONS).not.toContain(observation.kind);
      expect(observation.kind).not.toBe("provider_outage");
      expect(observation.kind).not.toBe("redis_failure");
      expect(observation.kind).not.toBe("api_failure");
    }
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toEqual([]);
  });

  it("hermes_memory source → claimClass INFERRED", () => {
    const observations = stamp([
      finding({
        kind: "mission_stuck",
        findingId: "mission_stuck:memory",
        claim: {
          source: "hermes_memory",
          sourceRef: "memory:orchestration:cycle-1",
          observedAt: NOW,
          verified: false,
          confidence: "uncertain",
          claim: "prior cycle recalled a stuck mission",
        },
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.claimClass).toBe("INFERRED");
    expect(observations[0]?.claimClass).not.toBe("VERIFIED");
    expect(observations[0]?.kind).toBe("mission_timeout");
  });

  it("claim.verified true still does NOT produce claimClass VERIFIED", () => {
    const observations = stamp([
      finding({
        kind: "worker_quarantined",
        findingId: "worker_quarantined:verified-claim",
        claim: {
          source: "worker_registry_port",
          sourceRef: "cg_worker:worker-7",
          observedAt: NOW,
          verified: true,
          confidence: "canonical",
          claim: "quarantine ledger row",
        },
      }),
      finding({
        kind: "mission_stuck",
        findingId: "mission_stuck:verified-memory",
        claim: {
          source: "hermes_memory",
          sourceRef: "memory:orchestration:cycle-2",
          observedAt: NOW,
          verified: true,
          confidence: "canonical",
          claim: "memory row claimed verified",
        },
      }),
    ]);
    expect(observations).toHaveLength(2);
    expect(observations[0]?.claimClass).toBe("OBSERVED");
    expect(observations[1]?.claimClass).toBe("INFERRED");
    for (const observation of observations) {
      expect(observation.claimClass).not.toBe("VERIFIED");
      expect(observation.claimClass).not.toBe("EXECUTED");
    }
  });

  it("summary is sliced to 300 chars and restates the finding — no invented metrics", () => {
    const long = "stuck execution without numeric invention ".repeat(20);
    expect(long.length).toBeGreaterThan(300);
    const observations = stamp([
      finding({
        kind: "mission_stuck",
        findingId: "mission_stuck:long",
        summary: long,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.summary).toBe(long.slice(0, 300));
    expect(observations[0]?.summary.length).toBe(300);
    expect(observations[0]?.summary).not.toMatch(/\berror[_-]?rate\b/i);
    expect(observations[0]?.summary).not.toMatch(/\blatency(?:Ms|_ms)?\b/i);
  });

  it("does not invent numeric metrics in the module source", () => {
    const source = readFileSync(MODULE_SRC, "utf8");
    expect(source).not.toMatch(/\berror[_-]?rate\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\blatency(?:Ms|_ms)?\s*[:=]\s*\d+/i);
    expect(source).not.toMatch(/\bp99(?:Latency)?\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\b(?:errorRate|latencyMs|throughput|qps|rps)\s*[:=]\s*\d/);
    expect(source).not.toMatch(/from\s+["'][^"']*hermes-cycle/);
    expect(source).not.toMatch(/from\s+["'][^"']*\.server/);
    expect(source).not.toMatch(/\bconsole\.log\b/);
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas any\b/);
    expect(source).not.toMatch(/provider_outage/);
    expect(source).not.toMatch(/redis_failure/);
    expect(source).not.toMatch(/api_failure/);
    expect(source).not.toMatch(/test_regression/);
  });
});
