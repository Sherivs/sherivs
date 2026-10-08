/**
 * Sherivs Experience System — authenticated destination resolution.
 *
 * After authentication the shell must land the person in THEIR context —
 * never a hardcoded runtime surface (SHERIVS_EXPERIENCE_ARCHITECTURE.md §9).
 * The destination is the home item of the navigation chrome resolved from
 * every installed runtime's contributions against the viewer's authorized
 * capability set; when no chrome resolves, the shell shows an honest
 * "no workspace yet" state instead of guessing.
 *
 * This module is platform-level: it speaks only in terms of contributions
 * and capability sets. Which capabilities a membership kind holds is declared
 * by the runtime layer and injected by the caller.
 */
import {
  hasNavDestinations,
  resolveWorkspaceHome,
  resolveWorkspaceNav,
  type NavContribution,
} from "@/lib/workspace-engine/navigation";

export type AuthenticatedDestination =
  | { kind: "workspace"; path: string }
  | { kind: "unlinked" }
  | { kind: "anonymous" };

export interface DestinationInput {
  /** Is there an authenticated session at all? */
  authenticated: boolean;
  /** Has the identity been linked to an organization membership or platform role? */
  linked: boolean;
  /** Every contribution published by installed runtimes (+ platform). */
  contributions: readonly NavContribution[];
  /** The viewer's authorized capability set (runtime-declared, server-enforced). */
  capabilities: ReadonlySet<string>;
}

export function resolveAuthenticatedDestination(input: DestinationInput): AuthenticatedDestination {
  if (!input.authenticated) return { kind: "anonymous" };
  if (!input.linked) return { kind: "unlinked" };
  const sections = resolveWorkspaceNav(input.contributions, input.capabilities);
  if (!hasNavDestinations(sections)) return { kind: "unlinked" };
  const home = resolveWorkspaceHome(sections) ?? sections[0]?.items[0]?.url ?? null;
  return home ? { kind: "workspace", path: home } : { kind: "unlinked" };
}
