/**
 * OBS-DD-01 — per-vendor observability kill switches.
 *
 * These switches sit ON TOP of the INFRA-01 staging gate in
 * vendor-telemetry.ts. They can only turn a vendor off; they never turn
 * Sentry or PostHog on outside explicit staging.
 *
 * - OBSERVABILITY_SENTRY_ENABLED   default ON.  Only the exact value "false" turns Sentry off.
 * - OBSERVABILITY_POSTHOG_ENABLED  default ON.  Only the exact value "false" turns PostHog off.
 * - OBSERVABILITY_DATADOG_ENABLED  default OFF. Only the exact value "true" turns Datadog on.
 *
 * Comparison is exact (no trim, no case folding), matching INFRA-01. Any
 * other spelling keeps the default, so a typo never silently changes
 * today's behaviour.
 *
 * Browser code cannot read server env at runtime. A production `vite build`
 * bakes OBSERVABILITY_SENTRY_ENABLED / OBSERVABILITY_POSTHOG_ENABLED into
 * import.meta.env.VITE_OBSERVABILITY_* (see vendor-telemetry.ts), so a client
 * switch change takes effect on the next deploy.
 *
 * Names only. This file never reads or prints credential values.
 */

export const SENTRY_SWITCH_ENV = "OBSERVABILITY_SENTRY_ENABLED" as const;
export const POSTHOG_SWITCH_ENV = "OBSERVABILITY_POSTHOG_ENABLED" as const;
export const DATADOG_SWITCH_ENV = "OBSERVABILITY_DATADOG_ENABLED" as const;
export const DATADOG_METRICS_SWITCH_ENV = "OBSERVABILITY_DATADOG_METRICS_ENABLED" as const;

export const CLIENT_SENTRY_SWITCH_ENV = `VITE_${SENTRY_SWITCH_ENV}` as const;
export const CLIENT_POSTHOG_SWITCH_ENV = `VITE_${POSTHOG_SWITCH_ENV}` as const;

type SwitchValue = string | null | undefined;

/** Default-on switch: only the exact string "false" disables. */
export function defaultOnSwitch(value: SwitchValue): boolean {
  return value !== "false";
}

/** Default-off switch: only the exact string "true" enables. */
export function defaultOffSwitch(value: SwitchValue): boolean {
  return value === "true";
}

export function sentrySwitchOn(value: SwitchValue): boolean {
  return defaultOnSwitch(value);
}

export function posthogSwitchOn(value: SwitchValue): boolean {
  return defaultOnSwitch(value);
}

export function datadogSwitchOn(value: SwitchValue): boolean {
  return defaultOffSwitch(value);
}
