/**
 * CoreGrid — installed runtime navigation (runtime layer registry).
 *
 * The kernel's workspace engine renders navigation CONTRIBUTIONS; it owns none. This
 * module is the runtime layer's list of what is installed, so the platform shell resolves
 * whatever the installed runtimes publish — installing another runtime adds its
 * navigation without editing the shell, the kernel or this contract.
 *
 * A runtime's own name belongs here and in the runtime layer, never in the kernel.
 */
import { RUNTIME_SCHOLAR, SCHOLAR_NAV_CONTRIBUTIONS } from "./scholar-nav-catalog";
import type { NavContribution } from "@/lib/workspace-engine/navigation";

/** Everything a runtime's own layer exports (capability sets, labels, helpers). */
export * from "./scholar-nav-catalog";
export {
  // The runtime's layer names its own primitives; the platform asks a neutral question
  // ("is this code declared by the runtime?") through this alias.
  isScholarFeatureCode as isDeclaredRuntimeFeatureCode,
} from "./scholar-nav-catalog";
export {
  // I-012 closure: the nav-kind membership tables are RUNTIME-DECLARED. The
  // runtime owns the domain-vocabulary statement (which of its roles hold which
  // of its chrome kinds) and the derived neutral membership; the platform gate
  // consumes both through these neutral aliases and holds no role list of its own.
  SCHOLAR_NAV_KIND_ROLE_ASSIGNMENTS as RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS,
  SCHOLAR_NAV_KIND_NEUTRAL_MEMBERSHIP as RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP,
  // I-010 follow-through: the legacy identity-store role semantics are the
  // runtime's DECLARED domain mapping (authoritative in the runtime layer);
  // the platform gate consumes it under this neutral alias.
  SCHOLAR_NEUTRAL_ROLE_MAPPINGS as RUNTIME_DECLARED_LEGACY_ROLE_MAPPINGS,
} from "./scholar-role-mappings";

/**
 * Neutral workspace-home resolution (Milestone 6 composition contract).
 *
 * The identity layer, switchers and wizards ask "where does a member with
 * this role land in the installed runtime?" — they never name a runtime's
 * symbols. With one installed runtime this delegates to the installed
 * runtime's own resolution; installing a second runtime composes here
 * without editing the platform layer.
 */
import { scholarWorkspaceHome } from "./scholar-nav-catalog";
import type { AppRole } from "@/lib/roles";

export function runtimeWorkspaceHome(role: AppRole): string {
  return scholarWorkspaceHome(role);
}

export interface InstalledNavContributionSet {
  /** Manifest identifier of the installed runtime, e.g. runtime:scholar. */
  runtimeId: string;
  contributions: readonly NavContribution[];
}

/** Installed runtimes, in installation order. Adding one is a line here. */
export const INSTALLED_NAV_CONTRIBUTION_SETS: readonly InstalledNavContributionSet[] = [
  { runtimeId: RUNTIME_SCHOLAR, contributions: SCHOLAR_NAV_CONTRIBUTIONS },
];

/** Every contribution from every installed runtime — what the shell renders. */
export const ALL_NAV_CONTRIBUTIONS: readonly NavContribution[] =
  INSTALLED_NAV_CONTRIBUTION_SETS.flatMap((set) => set.contributions);
