/**
 * Evidence-based Internal Console metric contracts.
 *
 * A metric is displayable only when its authoritative source can be queried.
 * Missing sources stay `available: false` rather than showing a placeholder number.
 */
export type ConsoleMetricContract = {
  key: string;
  name: string;
  definition: string;
  source: string;
  calculation: string;
  window: string;
  unit: string;
  freshness: string;
  authorization: string;
};

export const CONSOLE_METRIC_CONTRACTS: readonly ConsoleMetricContract[] = [
  {
    key: "control-plane-organizations",
    name: "Control-plane organizations",
    definition: "Organization lifecycle cases recorded for Sherivs staff onboarding.",
    source: "platform_organization",
    calculation: "count(*)",
    window: "current",
    unit: "organizations",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "active-organizations",
    name: "Active organizations",
    definition: "Lifecycle cases in state active. This is not the same as a loaded Scholar homepage.",
    source: "platform_organization.lifecycle_state",
    calculation: "count where lifecycle_state = active",
    window: "current",
    unit: "organizations",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "onboarding-organizations",
    name: "Organizations onboarding",
    definition: "Cases that have started and are not yet active, suspended, or deactivated.",
    source: "platform_organization.lifecycle_state",
    calculation: "count of pipeline states",
    window: "current",
    unit: "organizations",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "suspended-organizations",
    name: "Suspended organizations",
    definition: "Lifecycle cases in state suspended. Records are retained.",
    source: "platform_organization.lifecycle_state",
    calculation: "count where lifecycle_state = suspended",
    window: "current",
    unit: "organizations",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "onboarding-conversion",
    name: "Onboarding completion rate",
    definition: "Active cases divided by cases that have left draft.",
    source: "platform_organization",
    calculation: "active / (total - draft)",
    window: "all recorded cases",
    unit: "ratio",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "onboarding-duration",
    name: "Median onboarding duration",
    definition: "Median hours from submission to activation for activated cases.",
    source: "platform_organization.submitted_at and activated_at",
    calculation: "median(activated_at - submitted_at)",
    window: "activated cases with both timestamps",
    unit: "hours",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "failed-provisioning",
    name: "Failed provisioning operations",
    definition: "Cases currently in provisioning_failed. Retries are allowed and audited.",
    source: "platform_organization.lifecycle_state",
    calculation: "count where lifecycle_state = provisioning_failed",
    window: "current",
    unit: "cases",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "scholar-tenants",
    name: "Scholar tenant records",
    definition: "Rows in public.schools, the live Scholar tenant store. Includes tenants not created through the Internal Console questionnaire.",
    source: "public.schools",
    calculation: "count(*)",
    window: "current",
    unit: "tenants",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "registered-users",
    name: "Registered users",
    definition: "Identity-store rows in public.users. Platform staff without a school membership are excluded.",
    source: "public.users",
    calculation: "count(*)",
    window: "current",
    unit: "people",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "active-users-30d",
    name: "Active users (30 days)",
    definition: "Scholar users whose Auth last_sign_in_at is within 30 days. Account creation alone is not activity.",
    source: "auth.users.last_sign_in_at joined to public.users",
    calculation: "count where last_sign_in_at >= now() - 30 days",
    window: "trailing 30 days",
    unit: "people",
    freshness: "read at page load",
    authorization: "platform.tenants.read",
  },
  {
    key: "invitation-acceptance",
    name: "Staff invitation acceptance rate",
    definition: "Active staff divided by staff who were invited (active + invited + expired + revoked after invite).",
    source: "platform_staff",
    calculation: "active / (active + invited + expired + revoked with invited_at)",
    window: "current staff directory",
    unit: "ratio",
    freshness: "read at page load",
    authorization: "platform.staff.read",
  },
  {
    key: "subscription-ledger",
    name: "Commercial subscriptions",
    definition:
      "Recognized subscription, trial, past-due, and revenue totals from an authoritative billing ledger. schools.subscription_status is a coarse tenant access flag written by lifecycle operations and is not this metric.",
    source: "public.subscriptions",
    calculation: "count of subscription payment-history rows; not recognized revenue",
    window: "current ledger",
    unit: "subscriptions",
    freshness: "read at page load",
    authorization: "platform.finance.read",
  },
  {
    key: "runtime-availability",
    name: "Sherivs Scholar process availability",
    definition: "Application process health for the Scholar runtime. This is not organization onboarding completeness.",
    source: "buildHealthReport",
    calculation: "mapProcessHealth(status)",
    window: "current process",
    unit: "status",
    freshness: "read at page load",
    authorization: "console operator",
  },
];

export function metricContract(key: string): ConsoleMetricContract | null {
  return CONSOLE_METRIC_CONTRACTS.find((row) => row.key === key) ?? null;
}

export function formatRatio(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 1000) / 10}`;
}
