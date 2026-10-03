/**
 * CoreGrid — Phase 02 universal identity registry: typed contract for
 * `cg_identity` (C2 Identity Registry, L2 model 20260904020000).
 *
 * Mirrors the database truth (CHECK clauses, defaults) so application code
 * never invents values the database would reject. Boundary: performs NO
 * persistence and owns NO state — server functions record through
 * service-role adapters (deny-by-default RLS). Platform (P02) module; never
 * imported by kernel/ contracts (kernel purity list is unchanged).
 */

import {
  IDENTITY_KINDS,
  IDENTITY_STATES,
} from "@coregrid/contracts";
import type { IdentityKind, IdentityState } from "@coregrid/contracts";
export { IDENTITY_KINDS, IDENTITY_STATES } from "@coregrid/contracts";
export type { IdentityKind, IdentityState } from "@coregrid/contracts";

export function isIdentityKind(value: unknown): value is IdentityKind {
  return (IDENTITY_KINDS as readonly unknown[]).includes(value);
}

export function isIdentityState(value: unknown): value is IdentityState {
  return (IDENTITY_STATES as readonly unknown[]).includes(value);
}

export interface IdentityDraftInput {
  kind: IdentityKind;
  displayName: string;
  /** Optional link to an external subject (auth uid, org ref, agent key). */
  externalSubject?: string | null;
  /** Optional link into the kernel substrate (cg_entity). */
  entityId?: string | null;
  tenantId?: string | null;
  state?: IdentityState;
  verified?: boolean;
}

export interface IdentityRegistryRow {
  kind: IdentityKind;
  display_name: string;
  external_subject: string | null;
  entity_id: string | null;
  tenant_id: string | null;
  state: IdentityState;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Build an insert-ready cg_identity row (mirrors CHECK clauses + defaults). */
export function identityDraft(input: IdentityDraftInput, now: string): IdentityRegistryRow {
  if (!isIdentityKind(input.kind)) {
    throw new Error(`kind is not a registered identity kind (got "${input.kind}")`);
  }
  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 1 || displayName.length > 200) {
    throw new Error("display_name must be 1–200 characters");
  }
  const state = input.state ?? "provisioned";
  if (!isIdentityState(state)) {
    throw new Error(`state is not a registered identity state (got "${state}")`);
  }
  return {
    kind: input.kind,
    display_name: displayName,
    external_subject: trimOrNull(input.externalSubject),
    entity_id: trimOrNull(input.entityId),
    tenant_id: trimOrNull(input.tenantId),
    state,
    verified: input.verified ?? false,
    created_at: now,
    updated_at: now,
  };
}
