/**
 * CoreGrid — platform shell navigation (ADR-003 Option 1, GAP-008 / V1CAP-085).
 *
 * The global shell is PLATFORM-owned chrome (ADR-003, PROPOSED ruling pending
 * COND-004). Runtime content is admitted ONLY through the neutral registry:
 * this module resolves the navigation the shell renders from installed
 * runtime contribution sets, and it never imports a domain module directly.
 * Every rendered item carries the `runtimeRef` of the registered set that
 * contributed it, so chrome provenance is traceable back to a registry
 * entry.
 *
 * Fail-safe defaults: an empty (or wholly rejected) registry resolves to an
 * honest empty navigation — never a default chrome baked into the platform.
 *
 * Laws honoured here:
 * - Admitting content is mechanical: only runtimes the installed-runtime
 *   manifest declares may contribute, and a set is admitted only when every
 *   contribution inside it is actually published by that runtime.
 * - Resolution never grants: capability filtering is cosmetic (AGENTS §34);
 *   backend authorization remains the boundary.
 */
import {
  INSTALLED_NAV_CONTRIBUTION_SETS,
  type InstalledNavContributionSet,
} from "@/lib/runtime/nav-registry";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import {
  hasNavDestinations,
  resolveWorkspaceNav,
  type NavResolution,
} from "@/lib/workspace-engine/navigation";

export type ShellNavResolution = NavResolution;

export interface RejectedContributionSet {
  runtimeId: string;
  reason: string;
}

export interface ContributionAdmittance {
  admitted: readonly InstalledNavContributionSet[];
  rejected: readonly RejectedContributionSet[];
}

/** Runtime ids declared by the installed-runtime manifest — the admitting boundary. */
export function installedRuntimeIds(): ReadonlySet<string> {
  return new Set(INSTALLED_RUNTIMES.map((runtime) => runtime.id));
}

/**
 * Admit contribution sets only for runtimes the manifest declares, and only
 * when every contribution inside the set is actually published by that
 * runtime (its `runtimeRef` must equal the set's `runtimeId`). Anything else
 * is rejected — unregistered content never reaches the shell.
 */
export function admitNavContributionSets(
  sets: readonly InstalledNavContributionSet[],
): ContributionAdmittance {
  const declared = installedRuntimeIds();
  const admitted: InstalledNavContributionSet[] = [];
  const rejected: RejectedContributionSet[] = [];

  for (const set of sets) {
    if (!declared.has(set.runtimeId)) {
      rejected.push({
        runtimeId: set.runtimeId,
        reason: "Runtime is not declared by the installed-runtime manifest",
      });
      continue;
    }
    const foreign = set.contributions.find(
      (contribution) => contribution.runtimeRef !== set.runtimeId,
    );
    if (foreign !== undefined) {
      rejected.push({
        runtimeId: set.runtimeId,
        reason: `Contribution "${foreign.sectionKey}" is not published by ${set.runtimeId}`,
      });
      continue;
    }
    admitted.push(set);
  }

  return { admitted, rejected };
}

/**
 * Resolve the shell navigation from contribution sets × the viewer's
 * authorized capabilities. Only admitted sets participate; unknown capability
 * sets simply resolve to fewer (or zero) sections.
 */
export function resolveShellNav(
  sets: readonly InstalledNavContributionSet[],
  allowedCapabilities: ReadonlySet<string>,
): ShellNavResolution {
  const { admitted } = admitNavContributionSets(sets);
  const contributions = admitted.flatMap((set) => set.contributions);
  return resolveWorkspaceNav(contributions, allowedCapabilities);
}

/** Resolve the shell navigation from the platform's installed registry. */
export function resolveInstalledShellNav(
  allowedCapabilities: ReadonlySet<string>,
): ShellNavResolution {
  return resolveShellNav(INSTALLED_NAV_CONTRIBUTION_SETS, allowedCapabilities);
}

export { hasNavDestinations as shellNavHasDestinations };
