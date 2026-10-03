/**
 * CoreGrid — H3-018 memory-scoping enforcement tests (mission B-018 / J-029).
 *
 * Proves, against the pure contract in
 * `frontend/src/lib/context/memory-scope-enforcement.ts`:
 * - scope declarations are Zod-validated with tier-binding invariants
 *   (session/mission/long_term) and fail closed;
 * - access enforcement is deny-by-default and deny-by-gate, with a typed
 *   reason for every denial and an auditable decision record for EVERY
 *   outcome (allowed and denied);
 * - NO SILENT SCOPE EXPANSION: out-of-scope access is denied (never clamped),
 *   failed attempts never mutate the scope, and the ONLY widening path is an
 *   explicit, audited, typed expansion act that bumps the scope revision;
 * - retention-tier semantics: session scopes expire fail-closed and are the
 *   only tier that can be extended;
 * - purity: time is injected, no wall-clock sampling, inputs never mutated.
 *
 * Pure offline suite: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  applyMemoryScopeExpansion,
  declareMemoryScope,
  emptyMemoryScopeRegistry,
  enforceMemoryScopeAccess,
  memoryScopeDeclarationSchema,
  readMemoryScopeEntry,
  type MemoryScopeAccessRequest,
  type MemoryScopeAccessVerdict,
  type MemoryScopeDeclaration,
  type MemoryScopeDenialReason,
  type MemoryScopeExpansionAct,
  type MemoryScopeRegistry,
  type MemoryScopeSensitivity,
} from "../../frontend/src/lib/context/memory-scope-enforcement";
import type { ContextSensitivity } from "../../frontend/src/lib/context-assembly";

const NOW = "2026-10-03T00:00:00.000Z";
const LATER = "2026-10-03T06:00:00.000Z";
const AFTER_EXPIRY = "2026-10-03T13:00:00.000Z";

function declaration(overrides: Partial<MemoryScopeDeclaration> = {}): MemoryScopeDeclaration {
  return {
    scopeKey: "session-scope-alpha",
    tenantRef: "tenant-1",
    tier: "session",
    principals: ["agent-1"],
    domains: ["alpha"],
    maxSensitivity: "internal",
    actions: ["read", "write"],
    missionRef: null,
    sessionBinding: { sessionRef: "session-1", expiresAt: LATER },
    provenance: {
      declaredBy: "role:memory-scoping-enforcer",
      authorityRef: "AGENTS.md §42 / H3 mission B-018",
      declaredAt: NOW,
    },
    ...overrides,
  };
}

function access(overrides: Partial<MemoryScopeAccessRequest> = {}): MemoryScopeAccessRequest {
  return {
    scopeKey: "session-scope-alpha",
    tenantRef: "tenant-1",
    principalRef: "agent-1",
    action: "write",
    domain: "alpha",
    sensitivity: "internal",
    purpose: "bounded working recall",
    ...overrides,
  };
}

function baseRegistry(): MemoryScopeRegistry {
  return emptyMemoryScopeRegistry();
}

function declaredRegistry(overrides: Partial<MemoryScopeDeclaration> = {}): MemoryScopeRegistry {
  const result = declareMemoryScope(baseRegistry(), declaration(overrides));
  if (!result.ok) throw new Error(`fixture broken: ${result.error}`);
  return result.registry;
}

/** Narrows to the denied variant — asserts fail-closed denial on the way. */
function expectDenied(verdict: MemoryScopeAccessVerdict): { reason: MemoryScopeDenialReason; detail: string } {
  expect(verdict.verdict).toBe("denied");
  if (verdict.verdict !== "denied") throw new Error("expected a denial verdict");
  return { reason: verdict.reason, detail: verdict.detail };
}

function expectAllowed(verdict: MemoryScopeAccessVerdict): void {
  expect(verdict.verdict).toBe("allowed");
}

function expansion(
  act: Partial<MemoryScopeExpansionAct> & { kind: MemoryScopeExpansionAct["kind"] },
): MemoryScopeExpansionAct {
  const common = {
    scopeKey: "session-scope-alpha",
    reason: "explicitly authorized widening",
    declaredBy: "role:scope-governor",
    authorityRef: "H3 mission B-018 expansion authorization",
    decidedAt: NOW,
    ...act,
  };
  if (act.kind === "add_domains") {
    return { domains: ["beta"], ...common } as MemoryScopeExpansionAct;
  }
  if (act.kind === "add_principals") {
    return { principals: ["agent-2"], ...common } as MemoryScopeExpansionAct;
  }
  if (act.kind === "raise_sensitivity_ceiling") {
    return { maxSensitivity: "restricted", ...common } as MemoryScopeExpansionAct;
  }
  return { newExpiresAt: AFTER_EXPIRY, ...common } as MemoryScopeExpansionAct;
}

describe("scope declaration schema (fail-closed tier bindings)", () => {
  it("accepts a complete session-tier declaration with provenance", () => {
    const parsed = memoryScopeDeclarationSchema.safeParse(declaration());
    expect(parsed.success).toBe(true);
  });

  it("rejects anonymous declarations — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = declaration();
    const { provenance, ...rest } = anonymous;
    void provenance;
    expect(memoryScopeDeclarationSchema.safeParse(rest).success).toBe(false);
    expect(
      memoryScopeDeclarationSchema.safeParse(
        declaration({ provenance: { ...anonymous.provenance, declaredBy: "  " } }),
      ).success,
    ).toBe(false);
    expect(
      memoryScopeDeclarationSchema.safeParse(
        declaration({ provenance: { ...anonymous.provenance, declaredAt: "not-a-timestamp" } }),
      ).success,
    ).toBe(false);
  });

  it("requires a sessionBinding exactly for the session tier", () => {
    expect(memoryScopeDeclarationSchema.safeParse(declaration({ sessionBinding: null })).success).toBe(false);
    expect(
      memoryScopeDeclarationSchema.safeParse(declaration({ tier: "mission", missionRef: "mission-7" })).success,
    ).toBe(false);
  });

  it("requires a missionRef exactly for the mission tier", () => {
    expect(
      memoryScopeDeclarationSchema.safeParse(declaration({ tier: "mission", missionRef: null })).success,
    ).toBe(false);
    expect(
      memoryScopeDeclarationSchema.safeParse(
        declaration({ tier: "mission", missionRef: "mission-7", sessionBinding: null }),
      ).success,
    ).toBe(true);
    expect(
      memoryScopeDeclarationSchema.safeParse(
        declaration({ tier: "long_term", missionRef: "mission-7", sessionBinding: null }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict shape) so undeclared semantics cannot leak in", () => {
    const extra = declaration();
    const withExtra = { ...extra, universal: true } as unknown as Record<string, unknown>;
    expect(memoryScopeDeclarationSchema.safeParse(withExtra).success).toBe(false);
  });

  it("rejects malformed identifiers and sensitivity values", () => {
    expect(memoryScopeDeclarationSchema.safeParse(declaration({ scopeKey: "Bad Key" })).success).toBe(false);
    expect(memoryScopeDeclarationSchema.safeParse(declaration({ domains: ["has space"] })).success).toBe(false);
    expect(
      memoryScopeDeclarationSchema.safeParse(declaration({ maxSensitivity: "secret" as never })).success,
    ).toBe(false);
  });
});

describe("declareMemoryScope (fail-closed, no partial state)", () => {
  it("declares a valid scope at revision 1 with an empty expansion ledger", () => {
    const registry = baseRegistry();
    const result = declareMemoryScope(registry, declaration());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.revision).toBe(1);
      expect(result.entry.expansionLedger).toHaveLength(0);
      expect(readMemoryScopeEntry(result.registry, "session-scope-alpha")?.revision).toBe(1);
    }
  });

  it("rejects duplicate scope keys and malformed declarations without mutating the registry", () => {
    const registry = declaredRegistry();
    const before = registry.entries.length;
    const duplicate = declareMemoryScope(registry, declaration());
    expect(duplicate.ok).toBe(false);
    const malformed = declareMemoryScope(registry, declaration({ tenantRef: "" }));
    expect(malformed.ok).toBe(false);
    expect(registry.entries).toHaveLength(before);
  });

  it("never mutates the input registry — pure value semantics", () => {
    const registry = baseRegistry();
    declareMemoryScope(registry, declaration());
    expect(registry.entries).toHaveLength(0);
  });
});

describe("enforceMemoryScopeAccess — deny-by-default gates", () => {
  it("allows an in-scope access and audits it", () => {
    const registry = declaredRegistry();
    const verdict = enforceMemoryScopeAccess(registry, access(), { now: NOW });
    expectAllowed(verdict);
    expect(verdict.registry.decisionLog).toHaveLength(1);
    expect(verdict.decisionRecord.outcome).toBe("allowed");
    expect(verdict.decisionRecord.reason).toBeNull();
  });

  it("denies an undeclared scope — an undeclared scope grants nothing", () => {
    const denied = expectDenied(enforceMemoryScopeAccess(baseRegistry(), access(), { now: NOW }));
    expect(denied.reason).toBe("undeclared_scope");
  });

  it("denies cross-tenant access (Constitution §13)", () => {
    const denied = expectDenied(enforceMemoryScopeAccess(declaredRegistry(), access({ tenantRef: "tenant-2" }), { now: NOW }));
    expect(denied.reason).toBe("cross_tenant");
  });

  it("denies a principal outside the scope — empty principals bound nothing", () => {
    const empty = expectDenied(enforceMemoryScopeAccess(declaredRegistry({ principals: [] }), access(), { now: NOW }));
    expect(empty.reason).toBe("principal_not_in_scope");
    const foreign = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry(), access({ principalRef: "agent-9" }), { now: NOW }),
    );
    expect(foreign.reason).toBe("principal_not_in_scope");
  });

  it("denies actions the scope does not declare — empty actions permit nothing", () => {
    const readOnly = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry({ actions: ["read"] }), access({ action: "write" }), { now: NOW }),
    );
    expect(readOnly.reason).toBe("action_not_declared");
    const none = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry({ actions: [] }), access({ action: "read" }), { now: NOW }),
    );
    expect(none.reason).toBe("action_not_declared");
  });

  it("denies domains outside the declared scope — the core no-silent-expansion gate", () => {
    const denied = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry(), access({ domain: "beta" }), { now: NOW }),
    );
    expect(denied.reason).toBe("domain_outside_scope");
    expect(denied.detail).toContain("no silent scope expansion");
    const emptyDomains = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry({ domains: [] }), access(), { now: NOW }),
    );
    expect(emptyDomains.reason).toBe("domain_outside_scope");
  });

  it("denies sensitivity above the declared ceiling — never clamps", () => {
    const denied = expectDenied(
      enforceMemoryScopeAccess(declaredRegistry({ maxSensitivity: "public" }), access(), { now: NOW }),
    );
    expect(denied.reason).toBe("sensitivity_above_ceiling");
    expect(denied.detail).toContain("no silent scope expansion");
  });

  it("denies an expired session scope — expiry is fail-closed", () => {
    const denied = expectDenied(enforceMemoryScopeAccess(declaredRegistry(), access(), { now: AFTER_EXPIRY }));
    expect(denied.reason).toBe("scope_expired");
    expectAllowed(enforceMemoryScopeAccess(declaredRegistry(), access(), { now: LATER }));
  });

  it("long-term and mission tiers never expire — only session scopes expire", () => {
    const longTerm = declaredRegistry({ tier: "long_term", sessionBinding: null });
    expectAllowed(enforceMemoryScopeAccess(longTerm, access(), { now: AFTER_EXPIRY }));
    const mission = declaredRegistry({ tier: "mission", missionRef: "mission-7", sessionBinding: null });
    expectAllowed(enforceMemoryScopeAccess(mission, access(), { now: AFTER_EXPIRY }));
  });

  it("fails closed on an invalid injected clock and on malformed requests", () => {
    const registry = declaredRegistry();
    const badClock = expectDenied(enforceMemoryScopeAccess(registry, access(), { now: "not-a-timestamp" }));
    expect(badClock.reason).toBe("invalid_clock");
    const malformed = expectDenied(enforceMemoryScopeAccess(registry, access({ purpose: "" }), { now: NOW }));
    expect(malformed.reason).toBe("malformed_request");
    expect(registry.decisionLog).toHaveLength(0);
  });
});

describe("NO SILENT SCOPE EXPANSION — the structural invariants", () => {
  it("denied attempts never widen the scope, never produce a partial grant, and are audited", () => {
    const registry = declaredRegistry();
    const before = readMemoryScopeEntry(registry, "session-scope-alpha");
    expect(before?.revision).toBe(1);
    expect(before?.expansionLedger).toHaveLength(0);

    const denied = enforceMemoryScopeAccess(registry, access({ domain: "beta" }), { now: NOW });
    expect(denied.verdict).toBe("denied");
    expect(denied.registry.decisionLog).toHaveLength(1);

    const after = readMemoryScopeEntry(denied.registry, "session-scope-alpha");
    expect(after?.revision).toBe(1);
    expect(after?.expansionLedger).toHaveLength(0);
    expect(after?.declaration.domains).toEqual(["alpha"]);
  });

  it("the ONLY widening path is an explicit typed expansion act; revision bumps by exactly 1", () => {
    const registry = declaredRegistry();
    const result = applyMemoryScopeExpansion(registry, expansion({ kind: "add_domains", domains: ["beta", "gamma"] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.revision).toBe(2);
      expect(result.entry.declaration.domains).toEqual(["alpha", "beta", "gamma"]);
      expect(result.entry.expansionLedger).toHaveLength(1);
      expect(result.expansionRecord.act.kind).toBe("add_domains");
      expect(result.expansionRecord.act.declaredBy).toBe("role:scope-governor");
      expect(result.expansionRecord.appliedAt).toBe(NOW);
    }
    const widenedRegistry = result.ok ? result.registry : registry;
    const widened = readMemoryScopeEntry(widenedRegistry, "session-scope-alpha");
    expect(widened?.revision).toBe(2);
    expectAllowed(enforceMemoryScopeAccess(widenedRegistry, access({ domain: "beta" }), { now: NOW }));
  });

  it("every expansion variant widens and is audited: principals, ceiling, session extension", () => {
    const principalsResult = applyMemoryScopeExpansion(declaredRegistry(), expansion({ kind: "add_principals" }));
    expect(principalsResult.ok).toBe(true);
    if (principalsResult.ok) {
      expect(principalsResult.entry.declaration.principals).toEqual(["agent-1", "agent-2"]);
      expect(principalsResult.entry.expansionLedger[0]?.act.kind).toBe("add_principals");
    }

    const ceilingResult = applyMemoryScopeExpansion(
      declaredRegistry({ maxSensitivity: "public" }),
      expansion({ kind: "raise_sensitivity_ceiling", maxSensitivity: "restricted" }),
    );
    expect(ceilingResult.ok).toBe(true);
    if (ceilingResult.ok) {
      expect(ceilingResult.entry.declaration.maxSensitivity).toBe("restricted");
      expectAllowed(
        enforceMemoryScopeAccess(ceilingResult.registry, access({ sensitivity: "restricted" }), { now: NOW }),
      );
    }

    const extensionResult = applyMemoryScopeExpansion(declaredRegistry(), expansion({ kind: "extend_session" }));
    expect(extensionResult.ok).toBe(true);
    if (extensionResult.ok) {
      expect(extensionResult.entry.declaration.sessionBinding?.expiresAt).toBe(AFTER_EXPIRY);
      expectAllowed(enforceMemoryScopeAccess(extensionResult.registry, access(), { now: AFTER_EXPIRY }));
    }
  });

  it("rejects non-expanding acts — re-adding, lowering, or equal expiry change nothing", () => {
    const registry = declaredRegistry({ maxSensitivity: "internal" });
    const reAdd = applyMemoryScopeExpansion(registry, expansion({ kind: "add_domains", domains: ["alpha"] }));
    expect(reAdd.ok).toBe(false);
    if (!reAdd.ok) expect(reAdd.reason).toBe("act_does_not_expand");

    const lower = applyMemoryScopeExpansion(
      registry,
      expansion({ kind: "raise_sensitivity_ceiling", maxSensitivity: "public" }),
    );
    expect(lower.ok).toBe(false);
    if (!lower.ok) expect(lower.reason).toBe("act_does_not_expand");

    const equalOrEarlier = applyMemoryScopeExpansion(
      registry,
      expansion({ kind: "extend_session", newExpiresAt: NOW }),
    );
    expect(equalOrEarlier.ok).toBe(false);
    if (!equalOrEarlier.ok) expect(equalOrEarlier.reason).toBe("act_does_not_expand");

    expect(readMemoryScopeEntry(registry, "session-scope-alpha")?.revision).toBe(1);
    expect(readMemoryScopeEntry(registry, "session-scope-alpha")?.expansionLedger).toHaveLength(0);
  });

  it("only session-tier scopes can be extended (tier mismatch fails closed)", () => {
    const longTerm = declaredRegistry({ tier: "long_term", sessionBinding: null });
    const result = applyMemoryScopeExpansion(longTerm, expansion({ kind: "extend_session" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tier_mismatch_for_extension");
  });

  it("rejects malformed and undeclared-scope acts without mutating anything", () => {
    const registry = declaredRegistry();
    const malformed = applyMemoryScopeExpansion(registry, {
      kind: "add_domains",
      scopeKey: "session-scope-alpha",
      domains: [],
      reason: "x",
      declaredBy: "role:scope-governor",
      authorityRef: "authority",
      decidedAt: NOW,
    } as unknown as MemoryScopeExpansionAct);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed_act");

    const unknown = applyMemoryScopeExpansion(
      registry,
      expansion({ kind: "add_domains", scopeKey: "no-such-scope" }),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("undeclared_scope");

    expect(registry.entries).toHaveLength(1);
    expect(readMemoryScopeEntry(registry, "session-scope-alpha")?.revision).toBe(1);
  });

  it("the expansion ledger is append-only across successive acts (audit trail, AGENTS §12)", () => {
    let registry = declaredRegistry();
    const first = applyMemoryScopeExpansion(registry, expansion({ kind: "add_domains" }));
    expect(first.ok).toBe(true);
    if (first.ok) registry = first.registry;
    const second = applyMemoryScopeExpansion(registry, expansion({ kind: "add_principals" }));
    expect(second.ok).toBe(true);
    if (second.ok) registry = second.registry;
    const entry = readMemoryScopeEntry(registry, "session-scope-alpha");
    expect(entry?.revision).toBe(3);
    expect(entry?.expansionLedger.map((r) => r.act.kind)).toEqual(["add_domains", "add_principals"]);
  });
});

describe("audit ledger (§12/§29) and composition", () => {
  it("records every decision with unique ids, the injected instant, and typed provenance", () => {
    let registry = declaredRegistry();
    registry = enforceMemoryScopeAccess(registry, access(), { now: NOW }).registry;
    registry = enforceMemoryScopeAccess(registry, access({ domain: "beta" }), { now: NOW }).registry;
    registry = enforceMemoryScopeAccess(registry, access(), { now: NOW }).registry;
    expect(registry.decisionLog).toHaveLength(3);
    expect(new Set(registry.decisionLog.map((r) => r.id)).size).toBe(3);
    expect(registry.decisionLog.every((r) => r.recordedAt === NOW)).toBe(true);
    expect(registry.decisionLog.map((r) => r.outcome)).toEqual(["allowed", "denied", "allowed"]);
    expect(registry.decisionLog[1]?.reason).toBe("domain_outside_scope");
    expect(registry.decisionLog[1]?.scopeKey).toBe("session-scope-alpha");
    expect(registry.decisionLog[1]?.principalRef).toBe("agent-1");
    expect(registry.decisionLog[1]?.action).toBe("write");
  });

  it("reuses the context-assembly sensitivity vocabulary (composed, never redefined)", () => {
    const sensitivities: readonly ContextSensitivity[] = ["public", "internal", "restricted"];
    for (const sensitivity of sensitivities) {
      const registry = declaredRegistry({ maxSensitivity: sensitivity });
      const verdict = enforceMemoryScopeAccess(registry, access({ sensitivity }), { now: NOW });
      expect(verdict.verdict).toBe("allowed");
    }
    // Bidirectional type equivalence: the scope contract and the
    // context-assembly domain share ONE sensitivity vocabulary.
    const scopeSensitivity: MemoryScopeSensitivity = "restricted";
    const assemblySensitivity: ContextSensitivity = scopeSensitivity;
    const backToScope: MemoryScopeSensitivity = assemblySensitivity;
    expect(backToScope).toBe("restricted");
  });

  it("is pure: no wall-clock sampling, no input mutation across enforcement and expansion", () => {
    const registry = declaredRegistry();
    const snapshot = JSON.stringify(registry);
    enforceMemoryScopeAccess(registry, access({ domain: "beta" }), { now: NOW });
    applyMemoryScopeExpansion(registry, expansion({ kind: "add_domains" }));
    expect(JSON.stringify(registry)).toBe(snapshot);
  });
});
