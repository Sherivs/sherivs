/**
 * CoreGrid — platform shell org/workspace switcher contract (ADR-003, GAP-008).
 *
 * The switcher is platform chrome over the verified workspace engine
 * (`workspace-core.ts`) and org-model substrate. Its security posture is the
 * submit-resolve flow: the client submits a CHOICE — a workspace reference and
 * nothing else — and the SERVER resolves the resulting workspace context from
 * a directory it owns. Tenant context is derived exclusively from the
 * server-side directory record; no tenant context is ever accepted from
 * client storage or client-asserted fields (AGENTS §26, §34).
 *
 * The switcher menu itself renders only server-derived directory entries the
 * actor is authorized for; an empty directory renders an honest empty state,
 * never an invented default.
 */
import {
  switchWorkspaceContext,
  workspaceId,
  type WorkspaceContext,
  type WorkspaceContextSwitchResult,
  type WorkspaceType,
} from "@/lib/workspace-core";
import { tenantId as tenantRef } from "@/lib/tenant-core";

/**
 * What the switcher submits — a CHOICE only. Deliberately carries no tenant
 * context: the resolution below never reads one from here.
 */
export interface WorkspaceSwitchChoice {
  readonly workspaceId: string;
}

/** One server-owned directory entry the switcher may offer. */
export interface WorkspaceSwitchDirectoryEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: WorkspaceType;
}

/** Menu options the switcher renders — directory entries the actor may access. */
export interface WorkspaceSwitcherOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Project the switcher menu from the server-owned directory × the actor's
 * authorized workspace set. Unrelated directory entries are never offered.
 */
export function switcherOptions(
  directory: readonly WorkspaceSwitchDirectoryEntry[],
  authorizedWorkspaceIds: readonly string[],
): readonly WorkspaceSwitcherOption[] {
  return directory
    .filter((entry) => authorizedWorkspaceIds.includes(entry.id))
    .map((entry) => ({ id: entry.id, label: entry.name }));
}

/**
 * SERVER-side resolution of a client choice (the submit half of
 * submit-resolve). The choice is looked up in the server-owned directory,
 * tenant context is derived from the directory record, and the actual
 * switch decision (authorization, cross-tenant policy) is delegated to the
 * verified `switchWorkspaceContext` engine, which fails closed.
 */
export function resolveWorkspaceSwitchChoice(
  choice: WorkspaceSwitchChoice,
  directory: readonly WorkspaceSwitchDirectoryEntry[],
  from: WorkspaceContext,
  authorizedWorkspaceIds: readonly string[],
  actorId: string | null,
): WorkspaceContextSwitchResult {
  const entry = directory.find((candidate) => candidate.id === choice.workspaceId);
  if (entry === undefined) {
    return { ok: false, error: "Unknown workspace choice" };
  }
  if (!authorizedWorkspaceIds.includes(entry.id)) {
    return { ok: false, error: "Actor is not authorized to access this workspace" };
  }
  return switchWorkspaceContext(
    from,
    {
      id: workspaceId(entry.id),
      tenantId: tenantRef(entry.tenantId),
      name: entry.name,
      type: entry.type,
    },
    actorId,
    authorizedWorkspaceIds.map(workspaceId),
  );
}
