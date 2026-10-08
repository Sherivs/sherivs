/**
 * Sherivs — organization reality read-model (Milestone 9 substrate).
 *
 * An organization's LIVE STATE as the platform sees it, derived only from
 * the universal identity substrate (schools + users +
 * organization_memberships) — never from runtime-domain tables. This is the
 * universal answer to "what is the state of this organization" that any
 * surface (selector, workspace home, internal control) can render without
 * importing domain vocabulary.
 *
 * PURE derivation only — no I/O. The RLS-scoped server read lives in
 * `./organization-reality.functions.ts`.
 *
 * Canonical-truth boundary (Constitution §9): every field here is verified
 * system truth (rows, counts, flags). Nothing is predicted, inferred, or
 * AI-generated.
 */

export type OrganizationLifecycleState = "onboarding" | "operational" | "inactive";

export interface OrganizationReality {
  organizationId: string;
  name: string;
  slug: string | null;
  /** Manifest id of the runtime serving this organization. */
  runtimeId: string;
  onboardingCompleted: boolean;
  /**
   * Live member count AS VISIBLE TO THE READER under RLS — a member sees
   * their active organization's roster; other organizations' rosters are
   * not readable and report null, never a fabricated number.
   */
  memberCount: number | null;
  isActive: boolean;
  state: OrganizationLifecycleState;
}

/**
 * Derive the lifecycle state from verified truth.
 *
 *   inactive    — the organization is deactivated (nothing operates)
 *   onboarding  — active but the founder has not completed onboarding
 *   operational — active and onboarded
 */
export function deriveOrganizationState(input: {
  isActive: boolean;
  onboardingCompleted: boolean;
}): OrganizationLifecycleState {
  if (!input.isActive) return "inactive";
  return input.onboardingCompleted ? "operational" : "onboarding";
}

/** Human copy for the lifecycle state — the only rendering concern here. */
export function organizationStateLabel(state: OrganizationLifecycleState): string {
  switch (state) {
    case "onboarding":
      return "Setting up";
    case "operational":
      return "Active";
    case "inactive":
      return "Inactive";
  }
}
