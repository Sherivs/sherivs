/**
 * Personal twin role lenses (SV1-TWIN-02).
 *
 * A lens selects which assigned role/workspace context a personal twin acts in.
 * A lens can only NARROW authority: its permissions are always the intersection
 * of what it asks for and what the user's current role assignment already
 * grants (supplied by the server from the role engine, never by the client).
 * Persona is a label and scoped tools are gated by the lens permissions; neither
 * can add authority.
 *
 * Nothing here is stored or cached. Every call re-derives from the current
 * assignments, so removing a role removes its lens at once and switching
 * workspace builds a new context with nothing carried over.
 *
 * Pure functions: no I/O, no clock, no hidden state.
 */

/** The user's current effective assignment, as resolved server-side by the role engine. */
export interface RoleAssignmentView {
  readonly assignmentId: string;
  readonly roleCode: string;
  readonly templateCode: string;
  readonly workspaceId: string;
  /** Effective permission ids for this assignment (mandatory plus enabled optionals). */
  readonly permissions: readonly string[];
}

export interface LensTool {
  readonly toolId: string;
  /** The tool is available only when the lens holds this permission. */
  readonly requiresPermission: string;
}

/** A lens definition: what a twin would like to use within a role context. */
export interface LensSpec {
  readonly lensId: string;
  /** Presentation label only; it never changes permissions. */
  readonly persona: string;
  readonly requestedPermissions: readonly string[];
  readonly tools: readonly LensTool[];
}

export interface RoleLens {
  readonly lensId: string;
  readonly assignmentId: string;
  readonly workspaceId: string;
  readonly persona: string;
  /** Always a subset of the assignment's permissions. */
  readonly permissions: readonly string[];
  readonly tools: readonly string[];
  /** Requested permissions the assignment does not grant (dropped, never added). */
  readonly dropped: readonly string[];
  /** Memory scope key: distinct per assignment so context never carries over. */
  readonly contextKey: string;
}

const PERSONA_PATTERN = /^[a-z][a-z0-9_-]{1,40}$/;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * Build one lens. Returns null if the persona or spec is malformed (fail closed).
 * A spec that requests nothing yields a lens with no permissions, never "all".
 */
export function buildRoleLens(assignment: RoleAssignmentView, spec: LensSpec): RoleLens | null {
  if (
    typeof assignment?.assignmentId !== "string" ||
    assignment.assignmentId === "" ||
    typeof assignment.workspaceId !== "string" ||
    assignment.workspaceId === "" ||
    !Array.isArray(assignment.permissions) ||
    typeof spec?.lensId !== "string" ||
    spec.lensId === "" ||
    typeof spec.persona !== "string" ||
    !PERSONA_PATTERN.test(spec.persona) ||
    !Array.isArray(spec.requestedPermissions) ||
    !Array.isArray(spec.tools)
  ) {
    return null;
  }
  const granted = new Set(assignment.permissions);
  const requested = unique(spec.requestedPermissions);
  const permissions = requested.filter((p) => granted.has(p)).sort();
  const held = new Set(permissions);
  const tools = unique(
    spec.tools
      .filter((t) => typeof t?.toolId === "string" && held.has(t.requiresPermission))
      .map((t) => t.toolId),
  ).sort();
  return {
    lensId: spec.lensId,
    assignmentId: assignment.assignmentId,
    workspaceId: assignment.workspaceId,
    persona: spec.persona,
    permissions,
    tools,
    dropped: requested.filter((p) => !granted.has(p)).sort(),
    contextKey: `lens:${assignment.assignmentId}:${spec.lensId}`,
  };
}

/** All lenses the user currently has: one per (assignment, spec) the spec's template applies to. */
export function deriveLenses(
  assignments: readonly RoleAssignmentView[],
  specs: readonly (LensSpec & { readonly templateCodes: readonly string[] })[],
): readonly RoleLens[] {
  const lenses: RoleLens[] = [];
  for (const assignment of assignments) {
    for (const spec of specs) {
      if (!spec.templateCodes.includes(assignment.templateCode)) continue;
      const lens = buildRoleLens(assignment, spec);
      if (lens !== null) lenses.push(lens);
    }
  }
  return lenses;
}

export interface LensSelection {
  readonly workspaceId: string;
  readonly assignmentId: string;
  readonly lensId: string;
}

export interface ActiveLensContext {
  readonly lens: RoleLens;
  /** Always empty: a new context never inherits anything from the previous one. */
  readonly inherited: readonly never[];
}

/**
 * Resolve the active lens for a selection, from scratch. Returns null when the
 * assignment no longer exists, belongs to a different workspace, or no lens
 * matches, so a removed role has no lens the next time anything asks.
 */
export function resolveActiveLens(
  assignments: readonly RoleAssignmentView[],
  specs: readonly (LensSpec & { readonly templateCodes: readonly string[] })[],
  selection: LensSelection,
): ActiveLensContext | null {
  const assignment = assignments.find(
    (a) => a.assignmentId === selection.assignmentId && a.workspaceId === selection.workspaceId,
  );
  if (assignment === undefined) return null;
  const spec = specs.find(
    (s) => s.lensId === selection.lensId && s.templateCodes.includes(assignment.templateCode),
  );
  if (spec === undefined) return null;
  const lens = buildRoleLens(assignment, spec);
  return lens === null ? null : { lens, inherited: [] };
}

/**
 * Switch workspace. The new context is built only from the new selection and the
 * current assignments; nothing from `previous` is read, so no context carries
 * over. `previous` is accepted only so callers can show it was discarded.
 */
export function switchLensContext(
  _previous: ActiveLensContext | null,
  assignments: readonly RoleAssignmentView[],
  specs: readonly (LensSpec & { readonly templateCodes: readonly string[] })[],
  next: LensSelection,
): ActiveLensContext | null {
  return resolveActiveLens(assignments, specs, next);
}

/**
 * Re-check lenses a twin already holds against the current assignments: lenses
 * whose assignment is gone are removed, and the rest are re-narrowed to what the
 * assignment grants now.
 */
export function reconcileLenses(
  held: readonly RoleLens[],
  assignments: readonly RoleAssignmentView[],
  specs: readonly (LensSpec & { readonly templateCodes: readonly string[] })[],
): readonly RoleLens[] {
  const out: RoleLens[] = [];
  for (const lens of held) {
    const ctx = resolveActiveLens(assignments, specs, {
      workspaceId: lens.workspaceId,
      assignmentId: lens.assignmentId,
      lensId: lens.lensId,
    });
    if (ctx !== null) out.push(ctx.lens);
  }
  return out;
}
