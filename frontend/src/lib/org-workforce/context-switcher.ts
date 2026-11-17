/**
 * Context switcher view (ENGINE-18, ADR-096).
 *
 * One person can hold several roles in one organization and belong to several organizations.
 * Each (organization, role) pair is its own context, exactly as the entity engine keys a
 * context by identity, tenant and role. This groups a person's active memberships by
 * organization for the switcher and marks the current one. It offers only what the server
 * resolved as the person's own active memberships; it never invents a context, and a switch
 * is still made by the server (`switchActiveOrganization`), not by this view.
 */
export interface MembershipRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: string;
  readonly active: boolean;
}

export interface SwitcherOrganization {
  readonly organizationId: string;
  readonly name: string;
  readonly roles: readonly { readonly role: string; readonly current: boolean }[];
  readonly current: boolean;
}

export interface SwitcherView {
  readonly organizations: readonly SwitcherOrganization[];
  /** True when there is anything to switch between. */
  readonly canSwitch: boolean;
}

export function buildContextSwitcher(
  rows: readonly MembershipRow[],
  current: { readonly organizationId: string; readonly role: string } | null,
): SwitcherView {
  const byOrg = new Map<string, { name: string; roles: Set<string> }>();
  for (const r of rows) {
    if (!r.active) continue;
    const entry = byOrg.get(r.organizationId) ?? {
      name: r.organizationName,
      roles: new Set<string>(),
    };
    entry.roles.add(r.role);
    byOrg.set(r.organizationId, entry);
  }
  const organizations = [...byOrg.entries()]
    .map(([organizationId, v]) => ({
      organizationId,
      name: v.name,
      roles: [...v.roles].sort().map((role) => ({
        role,
        current: current?.organizationId === organizationId && current.role === role,
      })),
      current: current?.organizationId === organizationId,
    }))
    .sort(
      (a, b) => a.name.localeCompare(b.name) || a.organizationId.localeCompare(b.organizationId),
    );
  const contexts = organizations.reduce((n, o) => n + o.roles.length, 0);
  return { organizations, canSwitch: contexts > 1 };
}
