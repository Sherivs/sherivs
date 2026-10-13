/**
 * CoreGrid — provider-health → JarvisObservation translator (honest stamps).
 *
 * Translates already-stamped ProviderHealthObservationSource records into
 * JarvisObservation objects. This module never probes, never invents
 * outages or metrics, and never starts a resident process: it is a pure
 * mapping over evidence the health battery already produced.
 *
 * Honesty law:
 * - Empty reports or an invalid tenant yield zero observations.
 * - Reports with a blank provider/checkedAt, or a state outside
 *   PROVIDER_HEALTH_STATES, are skipped — never synthesized.
 * - claimClass is always OBSERVED (the battery stamped the report).
 *   Never VERIFIED, never EXECUTED.
 * - DETECTABLE_CONDITIONS kinds are used only when a probe actually failed
 *   (DEGRADED). NOT_CONFIGURED, NOT_REQUIRED, AUTHENTICATED, and
 *   OPERATIONAL never become outages.
 *
 * Structural source type only — do not import provider-health.server.ts
 * (that file is server-only).
 *
 * Pure in-process contract: no I/O, no vendors, no secrets.
 */

import type { JarvisObservation } from "../jarvis/enterprise-loop";

export const PROVIDER_HEALTH_OBSERVATION_SOURCE = "provider-health-battery" as const;

export const PROVIDER_HEALTH_STATES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "AUTHENTICATED",
  "OPERATIONAL",
  "DEGRADED",
  "NOT_REQUIRED",
] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

export interface ProviderHealthObservationSource {
  readonly provider: string;
  readonly state: ProviderHealthState;
  readonly detail: string;
  readonly checkedAt: string;
  readonly httpStatus: number | null;
  readonly durationMs: number;
}

const PROVIDER_HEALTH_STATE_SET: ReadonlySet<string> = new Set(PROVIDER_HEALTH_STATES);

const DETAIL_BOUND = 300;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isProviderHealthState(value: unknown): value is ProviderHealthState {
  return typeof value === "string" && PROVIDER_HEALTH_STATE_SET.has(value);
}

function kindAndSeverity(
  provider: string,
  state: ProviderHealthState,
): Pick<JarvisObservation, "kind" | "severity"> {
  switch (state) {
    case "DEGRADED":
      if (provider === "redis") return { kind: "redis_failure", severity: "warning" };
      if (provider === "resend") return { kind: "email_failure", severity: "warning" };
      return { kind: "provider_outage", severity: "warning" };
    case "NOT_CONFIGURED":
      return { kind: "provider_not_configured", severity: "info" };
    case "CONFIGURED":
      return { kind: "provider_credential_refused", severity: "warning" };
    case "AUTHENTICATED":
      return { kind: "provider_authenticated", severity: "info" };
    case "OPERATIONAL":
      return { kind: "provider_operational", severity: "info" };
    case "NOT_REQUIRED":
      return { kind: "provider_not_required", severity: "info" };
  }
}

function formatSummary(report: ProviderHealthObservationSource): string {
  const provider = report.provider.trim();
  const detail = typeof report.detail === "string" ? report.detail.slice(0, DETAIL_BOUND) : "";
  let summary = `${provider} ${report.state}: ${detail}`;
  if (typeof report.httpStatus === "number") {
    summary += ` (http ${report.httpStatus})`;
  }
  if (typeof report.durationMs === "number" && Number.isFinite(report.durationMs)) {
    summary += ` (${report.durationMs}ms)`;
  }
  return summary;
}

function stampOne(tenantRef: string, report: ProviderHealthObservationSource): JarvisObservation | null {
  if (isBlank(report.provider) || isBlank(report.checkedAt)) return null;
  if (!isProviderHealthState(report.state)) return null;
  const provider = report.provider.trim();
  const checkedAt = report.checkedAt.trim();
  const { kind, severity } = kindAndSeverity(provider, report.state);
  return {
    observationId: `provider-health:${provider}:${checkedAt}`,
    tenantRef,
    at: report.checkedAt,
    kind,
    severity,
    summary: formatSummary(report),
    evidenceRef: `provider-health:${provider}:${report.state}:${checkedAt}`,
    claimClass: "OBSERVED",
  };
}

export function stampProviderHealthObservations(input: {
  readonly tenantRef: string;
  readonly reports: readonly ProviderHealthObservationSource[];
}): readonly JarvisObservation[] {
  if (input === null || typeof input !== "object") return [];
  const tenantRef = typeof input.tenantRef === "string" ? input.tenantRef : "";
  if (tenantRef.trim().length === 0) return [];
  if (!Array.isArray(input.reports) || input.reports.length === 0) return [];

  const observations: JarvisObservation[] = [];
  for (const report of input.reports) {
    if (report === null || typeof report !== "object") continue;
    const observation = stampOne(tenantRef, report);
    if (observation !== null) observations.push(observation);
  }
  return observations;
}
