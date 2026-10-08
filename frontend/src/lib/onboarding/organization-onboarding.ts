import { z } from "zod";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Sherivs — organization onboarding state machine (§21).
 *
 * Pure derivation + validation ONLY: no vendor client, no fetch, no React.
 * The wizard route and the server function both consume this module so the
 * flow, its vocabulary and its guarantees are defined exactly once.
 *
 * Flow (directive §21, reduced to the steps that have a real substrate
 * behind them at V1 — no architecture theatre):
 *
 *   identity → type/runtime → profile → review → provisioning
 *
 * Steps that the directive lists beyond these (initial members, policies,
 * AI workforce configuration, integrations) are runtime-scope concerns
 * surfaced AFTER activation — a founder provisions an empty-but-real
 * organization and configures it inside their workspace. Asking a founder
 * to configure a runtime they have not activated yet is the school-admin
 * questionnaire anti-pattern this flow replaces (the runtime's own
 * configuration is collected inside the workspace it activates).
 */

export const ONBOARDING_STEPS = ["identity", "runtime", "profile", "review"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Runtimes a founder may select. V1 ships exactly one (AGENTS.md §45). */
export type RuntimeId = "scholar";

export interface RuntimeOffer {
  id: RuntimeId | string;
  label: string;
  description: string;
  available: boolean;
}

export const RUNTIME_OFFERS: readonly RuntimeOffer[] = [
  {
    id: "scholar",
    label: "Sherivs Scholar",
    description: "Education operations: people, academics, finance, communication.",
    available: true,
  },
  {
    id: "commerce",
    label: "Commerce",
    description: "Retail and services operations.",
    available: false,
  },
  {
    id: "health",
    label: "Healthcare",
    description: "Care and clinic operations.",
    available: false,
  },
  {
    id: "government",
    label: "Government",
    description: "Public service operations.",
    available: false,
  },
];

export function findRuntimeOffer(id: string): RuntimeOffer | undefined {
  return RUNTIME_OFFERS.find((offer) => offer.id === id);
}

/** Reserved slugs mirror the tenant resolver's subdomain reservations. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "dashboard",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use lowercase letters, digits and dashes.")
  .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved.");

export const nameSchema = z.string().trim().min(2).max(120);

export const onboardingInputSchema = z.object({
  organizationName: nameSchema,
  organizationSlug: slugSchema,
  founderName: nameSchema,
  runtime: z.literal("scholar"),
});
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;

/** Ordered wizard steps — a step is complete when its fields validate. */
export function stepCompleted(step: OnboardingStep, draft: DraftState): boolean {
  switch (step) {
    case "identity":
      return nameSchema.safeParse(draft.organizationName).success;
    case "runtime":
      return findRuntimeOffer(draft.runtime ?? "")?.available === true;
    case "profile":
      return (
        slugSchema.safeParse(draft.organizationSlug).success &&
        nameSchema.safeParse(draft.founderName).success
      );
    case "review":
      return false; // terminal step — never "complete", it submits
  }
}

export function currentStep(draft: DraftState): OnboardingStep {
  for (const step of ONBOARDING_STEPS) {
    if (!stepCompleted(step, draft)) return step;
  }
  return "review";
}

/** Server-error codes surfaced from the provisioning function's substrate. */
export type ProvisioningError = "SLUG_TAKEN" | "FOUNDER_ALREADY_LINKED" | "UNKNOWN";

export function mapProvisioningError(message: string): ProvisioningError {
  if (message.includes("duplicate key") && message.includes("schools_slug_key")) {
    return "SLUG_TAKEN";
  }
  if (message.includes("FOUNDER_ALREADY_LINKED")) return "FOUNDER_ALREADY_LINKED";
  return "UNKNOWN";
}

/** The error copy a founder sees — never the raw substrate message. */
export function provisioningErrorMessage(error: ProvisioningError): string {
  switch (error) {
    case "SLUG_TAKEN":
      return "That workspace address is already taken. Try another one.";
    case "FOUNDER_ALREADY_LINKED":
      return `Your account already belongs to an organization. Sign in and switch workspaces, or contact ${PLATFORM_NAME} support.`;
    case "UNKNOWN":
      return "Provisioning failed. Nothing was changed — try again, or contact support.";
  }
}

export interface DraftState {
  organizationName?: string;
  organizationSlug?: string;
  founderName?: string;
  runtime?: string;
}
