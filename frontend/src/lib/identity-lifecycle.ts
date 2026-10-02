/**
 * CoreGrid Identity Lifecycle Engine.
 *
 * Implements `architecture/phase-02-identity.md` G5 (Identity Lifecycle Engine):
 * - Lifecycle transitions are policy-controlled.
 * - Every transition is attributable (actor + reason).
 * - Suspended identities cannot be used.
 * - Deletion is soft (archival) before permanent destruction.
 */

import type {
  CoreGridIdentity,
  IdentityEvent,
  IdentityEventType,
  IdentityId,
  IdentityLifecycleState,
} from "./identity";
import { canTransitionIdentity } from "./identity";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Lifecycle transition request
 * ────────────────────────────────────────────────────────────*/

export interface LifecycleTransitionRequest {
  identity: CoreGridIdentity;
  from: IdentityLifecycleState;
  to: IdentityLifecycleState;
  /** Who is performing the transition (Invariant 09). */
  actorId: IdentityId;
  /** Why the transition is happening. */
  reason: string;
  /** Optional policy reference that authorizes this transition. */
  policyRef: string | null;
}

export type LifecycleTransitionResult =
  { ok: true; identity: CoreGridIdentity; event: IdentityEvent } | { ok: false; error: string };

/* ─────────────────────────────────────────────────────────────
 * Lifecycle engine
 * ────────────────────────────────────────────────────────────*/

export function transitionIdentityLifecycle(
  req: LifecycleTransitionRequest,
  now: string = timeAuthority.now().at,
): LifecycleTransitionResult {
  // 1. Validate the transition is allowed by the state machine.
  if (!canTransitionIdentity(req.from, req.to)) {
    return {
      ok: false,
      error: `Invalid lifecycle transition: ${req.from} -> ${req.to}`,
    };
  }

  // 2. Validate the identity's current state matches the request.
  if (req.identity.lifecycle !== req.from) {
    return {
      ok: false,
      error: `Identity lifecycle is '${req.identity.lifecycle}', expected '${req.from}'`,
    };
  }

  // 3. Deletion requires a reason (soft-delete policy).
  if (req.to === "deleted" && !req.reason.trim()) {
    return {
      ok: false,
      error: "Deletion requires a reason",
    };
  }

  // 4. Apply the transition.
  const updated: CoreGridIdentity = {
    ...req.identity,
    lifecycle: req.to,
    updatedAt: now,
  };

  const event: IdentityEvent = {
    id: crypto.randomUUID(),
    type: lifecycleEventType(req.to),
    actorId: req.actorId,
    subjectId: req.identity.id,
    tenantId: req.identity.tenantId,
    occurredAt: now,
    result: "success",
    correlationId: null,
    metadata: {
      from: req.from,
      to: req.to,
      reason: req.reason,
      policyRef: req.policyRef,
    },
  };

  return { ok: true, identity: updated, event };
}

function lifecycleEventType(to: IdentityLifecycleState): IdentityEventType {
  switch (to) {
    case "proposed":
      return "identity.created";
    case "suspended":
      return "identity.suspended";
    case "active":
      return "identity.restored";
    case "deleted":
      return "identity.deleted";
    default:
      return "identity.created";
  }
}

/* ─────────────────────────────────────────────────────────────
 * Convenience helpers
 * ────────────────────────────────────────────────────────────*/

export function isIdentityActive(id: Pick<CoreGridIdentity, "lifecycle">): boolean {
  return id.lifecycle === "active";
}

export function isIdentitySuspended(id: Pick<CoreGridIdentity, "lifecycle">): boolean {
  return id.lifecycle === "suspended";
}

export function isIdentityDeleted(id: Pick<CoreGridIdentity, "lifecycle">): boolean {
  return id.lifecycle === "deleted" || id.lifecycle === "archived";
}
