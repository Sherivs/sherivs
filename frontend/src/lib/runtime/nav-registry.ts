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
