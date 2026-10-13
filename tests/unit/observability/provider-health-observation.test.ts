/**
 * CoreGrid — provider-health → JarvisObservation translator tests.
 *
 * Proves the honesty law with injected stamps (no network, no probes):
 * empty/invalid input never synthesizes a report; only DEGRADED maps onto
 * DETECTABLE_CONDITIONS; NOT_CONFIGURED / NOT_REQUIRED / OPERATIONAL cannot
 * become outages; claimClass is always OBSERVED.
 */
import { describe, expect, it } from "vitest";
import { JarvisCapability } from "@/lib/jarvis/jarvis-contract";
import {
  DETECTABLE_CONDITIONS,
  runJarvisEnterpriseCycle,
} from "@/lib/jarvis/enterprise-loop";
import {
  PROVIDER_HEALTH_OBSERVATION_SOURCE,
  stampProviderHealthObservations,
  type ProviderHealthObservationSource,
} from "@/lib/observability/provider-health-observation";

const TENANT = "tenant-alpha";
const NOW = "2026-10-13T08:00:00.000Z";
const GRANTED = Object.values(JarvisCapability);

function source(
  partial: Partial<ProviderHealthObservationSource> &
    Pick<ProviderHealthObservationSource, "provider" | "state">,
): ProviderHealthObservationSource {
  return {
    detail: partial.detail ?? `${partial.provider} ${partial.state}`,
    checkedAt: partial.checkedAt ?? NOW,
    httpStatus: partial.httpStatus ?? null,
    durationMs: partial.durationMs ?? 0,
    ...partial,
    provider: partial.provider,
    state: partial.state,
  };
}

function stamp(
  reports: readonly ProviderHealthObservationSource[],
  tenantRef: string = TENANT,
) {
  return stampProviderHealthObservations({ tenantRef, reports });
}

describe("provider-health observation stamps — honesty law", () => {
  it("empty reports → no observations", () => {
    expect(stamp([])).toEqual([]);
    expect(PROVIDER_HEALTH_OBSERVATION_SOURCE).toBe("provider-health-battery");
  });

  it("OPERATIONAL supabase does not produce kind provider_outage / any DETECTABLE_CONDITION", () => {
    const observations = stamp([
      source({
        provider: "supabase",
        state: "OPERATIONAL",
        detail: "provider authenticated the read-only probe (http 200)",
        httpStatus: 200,
        durationMs: 18,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_operational");
    expect(observations[0]?.kind).not.toBe("provider_outage");
    expect(observations[0]?.severity).toBe("info");
    expect(DETECTABLE_CONDITIONS).not.toContain(observations[0]?.kind);
  });

  it("NOT_CONFIGURED paystack is provider_not_configured, not provider_outage", () => {
    const observations = stamp([
      source({
        provider: "paystack",
        state: "NOT_CONFIGURED",
        detail: "BLOCKED_NO_CREDENTIAL: PAYSTACK_SECRET_KEY is not set; no probe was attempted",
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_not_configured");
    expect(observations[0]?.kind).not.toBe("provider_outage");
    expect(observations[0]?.severity).toBe("info");
    expect(DETECTABLE_CONDITIONS).not.toContain("provider_not_configured");
    expect(observations[0]?.summary).toContain("paystack NOT_CONFIGURED:");
  });

  it("Redis NOT_REQUIRED is provider_not_required, not redis_failure", () => {
    const observations = stamp([
      source({
        provider: "redis",
        state: "NOT_REQUIRED",
        detail:
          "no REDIS_REST_URL/REDIS_REST_TOKEN supplied — the in-process rate limiter remains active (Part 31); distributed limiting stays disabled",
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_not_required");
    expect(observations[0]?.kind).not.toBe("redis_failure");
    expect(observations[0]?.severity).toBe("info");
    expect(DETECTABLE_CONDITIONS).not.toContain("provider_not_required");
  });

  it("Redis DEGRADED is redis_failure", () => {
    const observations = stamp([
      source({
        provider: "redis",
        state: "DEGRADED",
        detail: "provider responded with http 503 to the read-only probe",
        httpStatus: 503,
        durationMs: 41,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("redis_failure");
    expect(observations[0]?.severity).toBe("warning");
    expect(DETECTABLE_CONDITIONS).toContain("redis_failure");
  });

  it("Resend DEGRADED is email_failure", () => {
    const observations = stamp([
      source({
        provider: "resend",
        state: "DEGRADED",
        detail: "provider could not be reached for the read-only probe (connection refused)",
        httpStatus: null,
        durationMs: 22,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("email_failure");
    expect(observations[0]?.severity).toBe("warning");
  });

  it("AI gateway DEGRADED is provider_outage", () => {
    const observations = stamp([
      source({
        provider: "ai-gateway",
        state: "DEGRADED",
        detail: "provider responded with http 503 to the read-only probe",
        httpStatus: 503,
        durationMs: 41,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_outage");
    expect(observations[0]?.severity).toBe("warning");
  });

  it("CONFIGURED (401 refused) is provider_credential_refused, not provider_outage", () => {
    const observations = stamp([
      source({
        provider: "paystack",
        state: "CONFIGURED",
        detail: "provider refused the read-only probe (http 401); credential present but not accepted",
        httpStatus: 401,
        durationMs: 15,
      }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_credential_refused");
    expect(observations[0]?.kind).not.toBe("provider_outage");
    expect(observations[0]?.severity).toBe("warning");
    expect(DETECTABLE_CONDITIONS).not.toContain("provider_credential_refused");
    expect(observations[0]?.summary).toContain("http 401");
  });

  it("unknown state skipped", () => {
    const bogus = source({
      provider: "paystack",
      state: "OPERATIONAL",
    });
    const observations = stamp([
      { ...bogus, state: "TOTALLY_UNKNOWN" as ProviderHealthObservationSource["state"] },
      source({ provider: "supabase", state: "OPERATIONAL" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_operational");
    expect(observations[0]?.observationId).toBe(`provider-health:supabase:${NOW}`);
  });

  it("blank tenant → empty", () => {
    const reports = [source({ provider: "supabase", state: "OPERATIONAL" })];
    expect(stampProviderHealthObservations({ tenantRef: "", reports })).toEqual([]);
    expect(stampProviderHealthObservations({ tenantRef: "   ", reports })).toEqual([]);
  });

  it("claimClass OBSERVED, evidenceRef non-empty", () => {
    const checkedAt = "2026-10-13T08:01:00.000Z";
    const observations = stamp([
      source({
        provider: "supabase",
        state: "OPERATIONAL",
        checkedAt,
        httpStatus: 200,
        durationMs: 9,
      }),
    ]);
    expect(observations).toHaveLength(1);
    const observation = observations[0];
    expect(observation?.claimClass).toBe("OBSERVED");
    expect(observation?.claimClass).not.toBe("VERIFIED");
    expect(observation?.claimClass).not.toBe("EXECUTED");
    expect(observation?.evidenceRef.length).toBeGreaterThan(0);
    expect(observation?.evidenceRef).toBe(`provider-health:supabase:OPERATIONAL:${checkedAt}`);
    expect(observation?.observationId).toBe(`provider-health:supabase:${checkedAt}`);
    expect(observation?.at).toBe(checkedAt);
    expect(observation?.tenantRef).toBe(TENANT);
  });

  it("feeding OPERATIONAL-only stamps into runJarvisEnterpriseCycle produces zero detections/missions", () => {
    const observations = stamp([
      source({ provider: "supabase", state: "OPERATIONAL", httpStatus: 200, durationMs: 11 }),
      source({ provider: "paystack", state: "OPERATIONAL", httpStatus: 200, durationMs: 14 }),
    ]);
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(DETECTABLE_CONDITIONS).not.toContain(observation.kind);
    }
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toEqual([]);
    expect(result.missionProposals).toEqual([]);
  });

  it("feeding a DEGRADED redis stamp into runJarvisEnterpriseCycle detects redis_failure", () => {
    const observations = stamp([
      source({
        provider: "redis",
        state: "DEGRADED",
        detail: "provider could not be reached for the read-only probe (timeout)",
        httpStatus: null,
        durationMs: 8000,
      }),
    ]);
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations,
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]?.condition).toBe("redis_failure");
    expect(result.detections[0]?.claim.claimClass).toBe("OBSERVED");
  });

  it("skips reports whose provider or checkedAt is blank", () => {
    const observations = stamp([
      source({ provider: "", state: "DEGRADED" }),
      source({ provider: "   ", state: "DEGRADED" }),
      source({ provider: "supabase", state: "OPERATIONAL", checkedAt: "" }),
      source({ provider: "supabase", state: "OPERATIONAL", checkedAt: "   " }),
      source({ provider: "supabase", state: "OPERATIONAL" }),
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("provider_operational");
  });
});
