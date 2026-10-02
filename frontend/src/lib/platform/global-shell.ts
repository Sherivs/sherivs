/**
 * CoreGrid — platform global shell ownership contract (ADR-010, J-047 / GAP-008).
 *
 * RULING ARTIFACT: the global shell (navigation, org/tenant switcher, global
 * search, notifications, profile) is owned by the PLATFORM layer. Domain
 * runtimes COMPOSE INTO the shell through neutral contribution contracts and
 * never own it: no shell surface imports a runtime-domain module, and runtime
 * vocabulary enters only as data through the admitting boundary.
 *
 * This module is that contract in typed form. It is PURE and DOMAIN-NEUTRAL:
 * no vendor imports, no server client, no domain vocabulary — only neutral
 * refs, fail-closed resolutions, and hook types the platform injects real
 * resolvers into.
 *
 * Laws honoured here:
 * - Registry-only contribution: content reaches the shell only for runtimes
 *   the installed-runtime manifest declares (admitting is mechanical).
 * - Tenant/identity context is RESOLVED, never asserted: client hints are
 *   carried for audit only; context derives exclusively from server-owned
 *   records and fails closed (AGENTS §26, §34).
 * - Resolution never grants: capability filtering here is presentation;
 *   backend authorization remains the boundary (AGENTS §27, §34).
 */

/* ─────────────────────────────────────────────────────────────
 * Ownership vocabulary
 * ─────────────────────────────────────────────────────────────*/

/** The only layer that may own the shell. One legal value, on purpose. */
export type ShellOwnerLayer = "platform";
export const SHELL_OWNER_LAYER: ShellOwnerLayer = "platform";

/** Neutral refs — deliberately plain strings; no domain or vendor types. */
export type ActorRef = string;
export type TenantRef = string;
export type WorkspaceRef = string;
export type RuntimeRef = string;

/** Shell regions a runtime may contribute to. Owning is not on the list. */
export type ShellContributionKind = "nav" | "search" | "notification-source";

/* ─────────────────────────────────────────────────────────────
 * Navigation contribution contract
 * ─────────────────────────────────────────────────────────────*/

export interface ShellNavEntry {
  readonly key: string;
  readonly label: string;
  readonly iconKey: string;
  readonly url: string;
  /** Capability refs that gate PRESENTATION only — never authorization. */
  readonly capabilityRefs: readonly string[];
  readonly orderHint: number;
}

export interface ShellNavSection {
  readonly sectionKey: string;
  readonly sectionLabel: string;
  /** Provenance: the registered runtime that contributed this section. */
  readonly runtimeRef: RuntimeRef;
  readonly entries: readonly ShellNavEntry[];
}

export interface ShellNavContributionSet {
  readonly runtimeRef: RuntimeRef;
  readonly sections: readonly ShellNavSection[];
}

export interface RejectedShellContributionSet {
  readonly runtimeRef: RuntimeRef;
  readonly reason: string;
}

export interface ShellContributionAdmittance {
  readonly admitted: readonly ShellNavContributionSet[];
  readonly rejected: readonly RejectedShellContributionSet[];
}

/**
 * Admit contribution sets only for runtimes the manifest declares, and only
 * when every section inside the set is actually published by that runtime.
 * Anything else is rejected — unregistered content never reaches the shell.
 */
export function admitShellNavContributionSets(
  sets: readonly ShellNavContributionSet[],
  declaredRuntimeRefs: ReadonlySet<string>,
): ShellContributionAdmittance {
  const admitted: ShellNavContributionSet[] = [];
  const rejected: RejectedShellContributionSet[] = [];
  for (const set of sets) {
    if (!declaredRuntimeRefs.has(set.runtimeRef)) {
      rejected.push({
        runtimeRef: set.runtimeRef,
        reason: "Runtime is not declared by the installed-runtime manifest",
      });
      continue;
    }
    const forged = set.sections.some((section) => section.runtimeRef !== set.runtimeRef);
    if (forged) {
      rejected.push({
        runtimeRef: set.runtimeRef,
        reason: "Section was not published by its own runtime",
      });
      continue;
    }
    admitted.push(set);
  }
  return { admitted, rejected };
}

/**
 * Compose the nav the shell renders from ADMITTED sets, gated by the actor's
 * capability refs (cosmetic only), ordered deterministically. An empty or
 * wholly rejected registry resolves to an honest empty nav.
 */
export function composeShellNav(
  admittedSets: readonly ShellNavContributionSet[],
  actorCapabilityRefs: ReadonlySet<string>,
): readonly ShellNavSection[] {
  return admittedSets
    .flatMap((set) => set.sections)
    .map((section) => ({
      ...section,
      entries: section.entries
        .filter((entry) => entry.capabilityRefs.every((ref) => actorCapabilityRefs.has(ref)))
        .slice()
        .sort((a, b) => a.orderHint - b.orderHint || a.key.localeCompare(b.key)),
    }))
    .filter((section) => section.entries.length > 0);
}

/* ─────────────────────────────────────────────────────────────
 * Identity + tenant context resolution hooks
 * ─────────────────────────────────────────────────────────────*/

/**
 * What the client session ASSERTS. Never trusted: resolution derives real
 * identity server-side; asserted values are carried for audit comparison.
 */
export interface ShellSessionHint {
  readonly assertedActorRef: string | null;
  readonly assertedTenantRef: string | null;
}

/** Server-verified identity record (or null when verification failed). */
export interface ShellVerifiedIdentity {
  readonly actorRef: ActorRef | null;
  readonly tenantRef: TenantRef | null;
}

export type ShellIdentityResolution =
  | { readonly ok: true; readonly actorRef: ActorRef; readonly tenantRef: TenantRef }
  | { readonly ok: false; readonly reason: string };

/**
 * Real-identity resolution hook (platform-implemented). Fails closed: an
 * actor reaches the shell only with a server-verified identity AND tenant.
 * The session hint is never a source of truth — a forged asserted tenant
 * cannot smuggle context in.
 */
export function resolveShellIdentity(
  hint: ShellSessionHint,
  verified: ShellVerifiedIdentity | null,
): ShellIdentityResolution {
  if (!verified || !verified.actorRef || !verified.tenantRef) {
    return { ok: false, reason: "No verified identity; the shell resolves identity server-side only" };
  }
  return { ok: true, actorRef: verified.actorRef, tenantRef: verified.tenantRef };
}

/* ─────────────────────────────────────────────────────────────
 * Org/tenant switcher contract (submit-resolve)
 * ─────────────────────────────────────────────────────────────*/

/** One server-owned directory entry the switcher may offer. */
export interface ShellWorkspaceDirectoryEntry {
  readonly workspaceRef: WorkspaceRef;
  readonly tenantRef: TenantRef;
  readonly label: string;
}

/** What the switcher submits — a CHOICE only. No tenant context, ever. */
export interface ShellSwitcherChoice {
  readonly workspaceRef: WorkspaceRef;
}

export interface ShellSwitcherOption {
  readonly workspaceRef: WorkspaceRef;
  readonly label: string;
}

export interface ShellResolvedTenantContext {
  readonly tenantRef: TenantRef;
  readonly workspaceRef: WorkspaceRef;
  readonly workspaceLabel: string;
  readonly actorRef: ActorRef;
  readonly resolvedBy: "server-directory";
}

export type ShellTenantContextResolution =
  | { readonly ok: true; readonly context: ShellResolvedTenantContext }
  | { readonly ok: false; readonly reason: string };

/** Menu options: directory entries the actor is authorized for, nothing else. */
export function shellSwitcherOptions(
  directory: readonly ShellWorkspaceDirectoryEntry[],
  authorizedWorkspaceRefs: readonly WorkspaceRef[],
): readonly ShellSwitcherOption[] {
  return directory
    .filter((entry) => authorizedWorkspaceRefs.includes(entry.workspaceRef))
    .map((entry) => ({ workspaceRef: entry.workspaceRef, label: entry.label }));
}

/**
 * Tenant-context resolution hook (switcher half). SERVER-side resolution of
 * a client choice: the choice is looked up in the server-owned directory and
 * tenant context derives EXCLUSIVELY from the directory record — never from
 * the choice, the session hint, or any client-asserted field. Requires a
 * resolved identity; fails closed on unknown, unauthorized, or unresolved.
 */
export function resolveShellTenantContext(
  choice: ShellSwitcherChoice,
  directory: readonly ShellWorkspaceDirectoryEntry[],
  authorizedWorkspaceRefs: readonly WorkspaceRef[],
  identity: ShellIdentityResolution,
): ShellTenantContextResolution {
  if (!identity.ok) {
    return { ok: false, reason: "Identity unresolved; tenant context cannot resolve" };
  }
  const entry = directory.find((candidate) => candidate.workspaceRef === choice.workspaceRef);
  if (entry === undefined) {
    return { ok: false, reason: "Unknown workspace choice" };
  }
  if (!authorizedWorkspaceRefs.includes(entry.workspaceRef)) {
    return { ok: false, reason: "Actor is not authorized to access this workspace" };
  }
  return {
    ok: true,
    context: {
      tenantRef: entry.tenantRef,
      workspaceRef: entry.workspaceRef,
      workspaceLabel: entry.label,
      actorRef: identity.actorRef,
      resolvedBy: "server-directory",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Global search contract (provider fan-out)
 * ─────────────────────────────────────────────────────────────*/

export type ShellSearchScope =
  | { readonly kind: "tenant"; readonly tenantRef: TenantRef }
  | { readonly kind: "platform" };

export interface ShellSearchQuery {
  readonly text: string;
  /** The RESOLVED tenant context the search executes inside. */
  readonly tenantRef: TenantRef;
  readonly actorRef: ActorRef;
  readonly limit: number;
}

export interface ShellSearchHit {
  /** Provenance: the registered provider that produced this hit. */
  readonly providerRef: RuntimeRef;
  readonly resultRef: string;
  readonly label: string;
  readonly url: string;
  readonly scope: ShellSearchScope;
}

/**
 * A registered search provider. Runtimes implement this shape and register
 * it; the shell never queries a domain store directly. The contract is
 * domain-neutral: whatever the runtime searches, it answers in hits.
 */
export interface ShellSearchProvider {
  readonly providerRef: RuntimeRef;
  readonly kinds: readonly ShellContributionKind[];
  search(query: ShellSearchQuery): readonly ShellSearchHit[];
}

export interface ShellSearchOutcome {
  readonly hits: readonly ShellSearchHit[];
  /** Providers that failed or returned out-of-scope hits — withheld, audited. */
  readonly withheldByProvider: Readonly<Record<string, number>>;
}

/**
 * Execute global search: fan out to registered providers, withhold every hit
 * outside the resolved tenant scope (platform-scope hits pass), cap the
 * result, and fail closed per provider — a throwing provider is withheld and
 * audited, never surfaced, and never blocks the others.
 */
export function executeShellSearch(
  providers: readonly ShellSearchProvider[],
  query: ShellSearchQuery,
): ShellSearchOutcome {
  const withheldByProvider: Record<string, number> = {};
  const hits: ShellSearchHit[] = [];
  for (const provider of providers) {
    let produced: readonly ShellSearchHit[];
    try {
      produced = provider.search(query);
    } catch {
      withheldByProvider[provider.providerRef] =
        (withheldByProvider[provider.providerRef] ?? 0) + 1;
      continue;
    }
    let withheld = 0;
    for (const hit of produced) {
      const inScope =
        hit.scope.kind === "platform" ||
        (hit.scope.kind === "tenant" && hit.scope.tenantRef === query.tenantRef);
      if (!inScope) {
        withheld += 1;
        continue;
      }
      hits.push(hit);
    }
    if (withheld > 0) {
      withheldByProvider[provider.providerRef] =
        (withheldByProvider[provider.providerRef] ?? 0) + withheld;
    }
  }
  hits.sort(
    (a, b) =>
      a.providerRef.localeCompare(b.providerRef) || a.resultRef.localeCompare(b.resultRef),
  );
  return { hits: hits.slice(0, Math.max(0, query.limit)), withheldByProvider };
}

/* ─────────────────────────────────────────────────────────────
 * The shell surface (aggregate declaration)
 * ─────────────────────────────────────────────────────────────*/

export interface GlobalShellSurface {
  /** Always "platform" — runtimes compose in, never own. */
  readonly owner: ShellOwnerLayer;
  readonly nav: readonly ShellNavSection[];
  /** Registered search providers the shell fans out to. */
  readonly searchProviders: readonly RuntimeRef[];
  /** Contribution kinds currently composed into the shell. */
  readonly contributionKinds: readonly ShellContributionKind[];
}

export function composeGlobalShell(params: {
  declaredRuntimeRefs: ReadonlySet<string>;
  navSets: readonly ShellNavContributionSet[];
  actorCapabilityRefs: ReadonlySet<string>;
  searchProviders: readonly ShellSearchProvider[];
}): GlobalShellSurface {
  const admittance = admitShellNavContributionSets(params.navSets, params.declaredRuntimeRefs);
  const kinds = new Set<ShellContributionKind>(["nav", "search", "notification-source"]);
  for (const provider of params.searchProviders) {
    for (const kind of provider.kinds) kinds.add(kind);
  }
  return {
    owner: SHELL_OWNER_LAYER,
    nav: composeShellNav(admittance.admitted, params.actorCapabilityRefs),
    searchProviders: params.searchProviders.map((provider) => provider.providerRef),
    contributionKinds: [...kinds].sort(),
  };
}
