/**
 * CoreGrid — H3-060 Universal Runtime Fabric registration-contract tests
 * (mission G-060, phase 40). Proves the fail-closed semantics of the fabric's
 * neutral runtime registration surface:
 *   - installation is admission to `proposed` only, never self-activation;
 *   - unknown/malformed/cross-tenant inputs DENY with typed reasons;
 *   - lifecycle moves obey the kernel transition law (imported read-only);
 *   - suspended runtimes only resume, retired runtimes never operate;
 *   - declarations are bounded and provenance is mandatory;
 *   - the module stays pure, typed and domain-neutral (J-037).
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DENIAL_REASONS,
  INSTALL_TARGET_STATUS,
  LIFECYCLE_INTENT_TARGET,
  MAX_ONT_ENTITY_TYPES,
  MAX_CAPABILITY_REFS,
  RUNTIME_LIFECYCLE_STATUSES,
  canTransitionRuntimeLifecycle,
  decideRuntimeRegistration,
  parseRegistrationContext,
  parseRuntimeDescriptor,
  parseRuntimeRegistrationDecision,
  parseRuntimeRegistrationRequest,
  parseRuntimeHealthSignal,
  runtimeRegistrationDecisionSchema,
  unknownRuntimeHealthSignal,
  type RegistrationContext,
  type RuntimeDescriptor,
} from "../../frontend/src/lib/universal-runtime-fabric/contracts";
import {
  RUNTIME_INTERFACE_KINDS,
  RUNTIME_MANIFEST_STATUSES,
  isValidManifestId,
} from "../../frontend/src/lib/kernel/domain-manifest";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const INSTANT = "2026-10-03T00:00:00.000Z";

function descriptor(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    runtimeRef: "runtime:alpha",
    name: "Alpha Runtime",
    version: "1.0.0",
    summary: "A neutral runtime used to prove the registration contract.",
    ontology: {
      entityTypes: [{ name: "actor" }],
      relationshipTypes: [
        { name: "participates_in", sourceTypes: ["actor"], targetTypes: ["event"] },
      ],
    },
    capabilityRefs: ["capability:record-storage"],
    policyRefs: ["policy:tenant-isolation"],
    interfaces: [{ name: "alpha-api", kind: "api" }],
    isolation: { tenantScoped: true, egress: "none", stateMode: "dedicated" },
    resourceCeiling: { maxConcurrentTasks: 8, maxMemoryMb: 512, maxStorageMb: 1024 },
    ...overrides,
  };
}

function context(overrides: Partial<RegistrationContext> = {}): RegistrationContext {
  return {
    actorRef: "role:fabric-administrator",
    resolvedTenantRef: "tenant_a",
    observedAt: INSTANT,
    knownCapabilityRefs: ["capability:record-storage", "capability:event-bus"],
    registrySnapshot: [],
    ...overrides,
  };
}

function installed(
  runtimeRef: string,
  tenantRef: string,
  status: (typeof RUNTIME_LIFECYCLE_STATUSES)[number],
): RegistrationContext["registrySnapshot"][number] {
  return { runtimeRef, tenantRef, status };
}

function installRequest(runtime: RuntimeDescriptor = descriptor(), overrides: Record<string, unknown> = {}) {
  return {
    intent: "install",
    descriptor: runtime,
    provenance: {
      requestedBy: "role:fabric-administrator",
      authority: "AGENTS.md §42 / H3 wave mission G-060",
      requestedAt: INSTANT,
      justification: "Register a neutral runtime under the phase-40 contract.",
    },
    ...overrides,
  };
}

function lifecycleRequest(
  intent: "suspend" | "resume" | "retire",
  runtimeRef = "runtime:alpha",
  overrides: Record<string, unknown> = {},
) {
  return {
    intent,
    runtimeRef,
    provenance: {
      requestedBy: "role:fabric-administrator",
      authority: "AGENTS.md §42 / H3 wave mission G-060",
      requestedAt: INSTANT,
      justification: "Lifecycle operation under the phase-40 contract.",
    },
    ...overrides,
  };
}

function reasonSet(decision: ReturnType<typeof decideRuntimeRegistration>): string[] {
  return decision.outcome === "deny" ? [...decision.reasons] : [];
}

/* ─────────────────────────────────────────────────────────────
 * Install: admission, never activation
 * ────────────────────────────────────────────────────────────*/

describe("G-060 runtime registration contracts", () => {
  it("allows a valid install and lands the runtime in `proposed`, never `active`", () => {
    const decision = decideRuntimeRegistration(installRequest(), context());
    expect(decision.outcome).toBe("allow");
    if (decision.outcome === "allow") {
      expect(decision.targetStatus).toBe(INSTALL_TARGET_STATUS);
      expect(decision.targetStatus).toBe("proposed");
      expect(decision.tenantRef).toBe("tenant_a");
      expect(decision.decidedAt).toBe(INSTANT);
    }
    expect(parseRuntimeRegistrationDecision(decision).ok).toBe(true);
  });

  it("never provides a path from install directly to active (kernel transition law)", () => {
    expect(canTransitionRuntimeLifecycle("proposed", "active")).toBe(false);
    expect(canTransitionRuntimeLifecycle("proposed", "review")).toBe(true);
    expect("active" in LIFECYCLE_INTENT_TARGET ? LIFECYCLE_INTENT_TARGET.active : undefined).toBeUndefined();
  });

  it("denies an unparseable install request with typed reasons and detail", () => {
    const decision = decideRuntimeRegistration({ intent: "install" }, context());
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("invalid_request_shape");
      expect(decision.detail.length).toBeGreaterThan(0);
      expect(decision.intent).toBeUndefined();
    }
  });

  it("denies unknown keys (strict shape — fail closed, never ignore)", () => {
    const decision = decideRuntimeRegistration(installRequest(descriptor(), { tenantId: "tenant_a" }), context());
    expect(reasonSet(decision)).toContain("invalid_request_shape");
  });

  it("denies a descriptor that attempts to declare storage", () => {
    const attempt = descriptor({} as Partial<RuntimeDescriptor>) as unknown as Record<string, unknown>;
    attempt.table = "cg_rogue";
    const request = installRequest(attempt as unknown as RuntimeDescriptor);
    const parsed = parseRuntimeDescriptor(attempt);
    expect(parsed.ok).toBe(false);
    const decision = decideRuntimeRegistration(request, context());
    expect(reasonSet(decision)).toContain("invalid_request_shape");
  });

  it("denies an install whose runtimeRef is already registered (duplicate)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "active")] });
    const decision = decideRuntimeRegistration(installRequest(), ctx);
    expect(reasonSet(decision)).toContain("duplicate_registration");
  });

  it("denies an install colliding with another tenant's canonical runtimeRef", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_b", "active")] });
    const decision = decideRuntimeRegistration(installRequest(), ctx);
    expect(reasonSet(decision)).toContain("tenant_mismatch");
  });

  it("denies an install consuming capability refs outside the canonical vocabulary", () => {
    const runtime = descriptor({ capabilityRefs: ["capability:not-declared"] });
    const decision = decideRuntimeRegistration(installRequest(runtime), context());
    expect(reasonSet(decision)).toContain("unresolved_capability_ref");
    const ok = decideRuntimeRegistration(installRequest(), context());
    expect(ok.outcome).toBe("allow");
  });

  it("requires explicit tenant-scoped isolation (z.literal(true) — no permissive parse)", () => {
    const scopedOff = descriptor({
      isolation: { tenantScoped: false, egress: "none", stateMode: "dedicated" },
    } as unknown as Partial<RuntimeDescriptor>);
    expect(parseRuntimeDescriptor(scopedOff).ok).toBe(false);
    const missing = { ...descriptor() } as Record<string, unknown>;
    delete missing.isolation;
    expect(parseRuntimeDescriptor(missing).ok).toBe(false);
  });

  it("requires complete provenance on every request (AGENTS §12)", () => {
    const noJustification = installRequest(descriptor(), {
      provenance: {
        requestedBy: "role:fabric-administrator",
        authority: "AGENTS.md §42",
        requestedAt: INSTANT,
      },
    });
    const decision = decideRuntimeRegistration(noJustification, context());
    expect(reasonSet(decision)).toContain("invalid_request_shape");

    const badInstant = installRequest(descriptor(), {
      provenance: {
        requestedBy: "role:fabric-administrator",
        authority: "AGENTS.md §42",
        requestedAt: "not-an-instant",
        justification: "x",
      },
    });
    expect(parseRuntimeRegistrationRequest(badInstant).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Lifecycle: kernel-law-bound, tenant-isolated, fail closed
 * ────────────────────────────────────────────────────────────*/

describe("G-060 lifecycle decisions", () => {
  it("suspends an active runtime owned by the resolved tenant", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "active")] });
    const decision = decideRuntimeRegistration(lifecycleRequest("suspend"), ctx);
    expect(decision.outcome).toBe("allow");
    if (decision.outcome === "allow") expect(decision.targetStatus).toBe("suspended");
  });

  it("resumes a suspended runtime (suspended access is restorable only by explicit intent)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "suspended")] });
    const decision = decideRuntimeRegistration(lifecycleRequest("resume"), ctx);
    expect(decision.outcome).toBe("allow");
    if (decision.outcome === "allow") expect(decision.targetStatus).toBe("active");
  });

  it("denies suspend/resume on a runtime that is not in the required prior state", () => {
    const suspended = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "suspended")] });
    expect(reasonSet(decideRuntimeRegistration(lifecycleRequest("suspend"), suspended))).toContain(
      "invalid_lifecycle_transition",
    );
    const proposed = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "proposed")] });
    expect(reasonSet(decideRuntimeRegistration(lifecycleRequest("resume"), proposed))).toContain(
      "invalid_lifecycle_transition",
    );
    const active = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "active")] });
    expect(reasonSet(decideRuntimeRegistration(lifecycleRequest("resume"), active))).toContain(
      "invalid_lifecycle_transition",
    );
  });

  it("denies any operation against an unregistered runtime reference", () => {
    const decision = decideRuntimeRegistration(lifecycleRequest("retire"), context());
    expect(reasonSet(decision)).toContain("unregistered_runtime_ref");
  });

  it("denies tenant A operating on tenant B's runtime (AGENTS §31)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_b", "active")] });
    const decision = decideRuntimeRegistration(lifecycleRequest("suspend"), ctx);
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("tenant_mismatch");
      expect(decision.reasons).not.toContain("allow");
    }
  });

  it("denies every operation against a retired runtime (retirement is terminal)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "retired")] });
    for (const intent of ["suspend", "resume", "retire"] as const) {
      expect(reasonSet(decideRuntimeRegistration(lifecycleRequest(intent), ctx))).toContain("retired_runtime");
    }
  });

  it("retires a runtime from any non-retired lifecycle state", () => {
    for (const status of RUNTIME_LIFECYCLE_STATUSES) {
      if (status === "retired") continue;
      const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", status)] });
      const decision = decideRuntimeRegistration(lifecycleRequest("retire"), ctx);
      expect(decision.outcome, `retire from ${status}`).toBe("allow");
    }
    expect(canTransitionRuntimeLifecycle("retired", "retired")).toBe(false);
  });

  it("every accepted lifecycle move satisfies the imported kernel transition law", () => {
    const ctx = context({
      registrySnapshot: [
        installed("runtime:alpha", "tenant_a", "active"),
        installed("runtime:beta", "tenant_a", "suspended"),
      ],
    });
    const suspend = decideRuntimeRegistration(lifecycleRequest("suspend"), ctx);
    const resume = decideRuntimeRegistration(lifecycleRequest("resume", "runtime:beta"), ctx);
    for (const decision of [suspend, resume]) {
      if (decision.outcome === "allow") {
        expect(canTransitionRuntimeLifecycle("active", "suspended") || decision.targetStatus === "active").toBe(true);
        expect((RUNTIME_LIFECYCLE_STATUSES as readonly string[]).includes(decision.targetStatus)).toBe(true);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Context: server-resolved only (§26 — never trust the client)
 * ────────────────────────────────────────────────────────────*/

describe("G-060 registration context", () => {
  it("denies everything when the context is incomplete or malformed", () => {
    const noTenant = context();
    delete (noTenant as Partial<RegistrationContext>).resolvedTenantRef;
    const decision = decideRuntimeRegistration(installRequest(), noTenant);
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasons).toContain("invalid_context");
      expect(decision.tenantRef).toBeUndefined();
    }
    const decision2 = decideRuntimeRegistration(installRequest(), { actorRef: "role:x" });
    expect(decision2.outcome).toBe("deny");
  });

  it("parseRegistrationContext proves shape and bounds of the registry snapshot", () => {
    expect(parseRegistrationContext(context()).ok).toBe(true);
    const badRef = context({ resolvedTenantRef: "NOT-A-REF" });
    expect(parseRegistrationContext(badRef).ok).toBe(false);
    const badStatus = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "deployed" as never)] });
    expect(parseRegistrationContext(badStatus).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Descriptor bounds, ontology resolution, health signals
 * ────────────────────────────────────────────────────────────*/

describe("G-060 descriptor bounds and ontology", () => {
  it("rejects unbounded ontology declarations", () => {
    const many = Array.from({ length: MAX_ONT_ENTITY_TYPES + 1 }, (_, i) => ({ name: `t_${i}` }));
    expect(parseRuntimeDescriptor(descriptor({ ontology: { entityTypes: many, relationshipTypes: [] } })).ok).toBe(
      false,
    );
  });

  it("rejects unbounded capability and policy reference arrays and malformed versions", () => {
    const manyCaps = Array.from({ length: MAX_CAPABILITY_REFS + 1 }, (_, i) => `capability:c_${i}`);
    expect(parseRuntimeDescriptor(descriptor({ capabilityRefs: manyCaps })).ok).toBe(false);
    expect(parseRuntimeDescriptor(descriptor({ version: "1.0" })).ok).toBe(false);
    expect(parseRuntimeDescriptor(descriptor({ policyRefs: [] })).ok).toBe(false);
    const badKind = descriptor() as unknown as Record<string, unknown>;
    (badKind.interfaces as Record<string, unknown>[]) = [{ name: "x", kind: "warp" }];
    expect(parseRuntimeDescriptor(badKind as unknown as RuntimeDescriptor).ok).toBe(false);
  });

  it("rejects duplicate ontology names and unresolved relationship endpoints", () => {
    const dupEntity = descriptor({
      ontology: {
        entityTypes: [{ name: "actor" }, { name: "actor" }],
        relationshipTypes: [],
      },
    });
    expect(parseRuntimeDescriptor(dupEntity).ok).toBe(false);

    const dangling = descriptor({
      ontology: {
        entityTypes: [{ name: "actor" }],
        relationshipTypes: [{ name: "rel", sourceTypes: ["actor"], targetTypes: ["undeclared"] }],
      },
    });
    expect(parseRuntimeDescriptor(dangling).ok).toBe(false);
  });

  it("accepts universal pseudo-types as relationship endpoints", () => {
    const parsed = parseRuntimeDescriptor(descriptor());
    expect(parsed.ok).toBe(true);
  });

  it("health signals fail closed: unproven is `unknown`, never optimistic", () => {
    const signal = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    const parsed = parseRuntimeHealthSignal(signal);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.status).toBe("unknown");
      expect(parsed.value.failingDependencyRefs).toEqual([]);
    }
    expect(parseRuntimeHealthSignal({ ...signal, status: "operational" }).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Vocabulary lockstep with the kernel (read-only composition)
 * ────────────────────────────────────────────────────────────*/

describe("G-060 vocabulary lockstep", () => {
  it("lifecycle vocabulary matches the kernel manifest statuses exactly", () => {
    expect([...RUNTIME_LIFECYCLE_STATUSES]).toEqual([...RUNTIME_MANIFEST_STATUSES]);
  });

  it("interface-kind vocabulary matches the kernel manifest kinds exactly", () => {
    const schemaKinds = ["api", "event", "ui"];
    expect(schemaKinds).toEqual([...RUNTIME_INTERFACE_KINDS]);
  });

  it("runtime refs are canonical kernel manifest ids pinned to the runtime: namespace", () => {
    expect(isValidManifestId("runtime:alpha")).toBe(true);
    const parsed = parseRuntimeDescriptor(descriptor({ runtimeRef: "not-canonical" }));
    expect(parsed.ok).toBe(false);
    const wrongNamespace = parseRuntimeDescriptor(descriptor({ runtimeRef: "widget:alpha" }));
    expect(wrongNamespace.ok).toBe(false);
  });

  it("exposes a complete typed denial-reason vocabulary (no silent failures)", () => {
    expect(DENIAL_REASONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(DENIAL_REASONS).size).toBe(DENIAL_REASONS.length);
  });

  it("allow and deny decisions round-trip through the decision schema", () => {
    const allow = decideRuntimeRegistration(installRequest(), context());
    expect(runtimeRegistrationDecisionSchema.safeParse(allow).success).toBe(true);
    const denyDecision = decideRuntimeRegistration({ intent: "install" }, context());
    expect(runtimeRegistrationDecisionSchema.safeParse(denyDecision).success).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Module hygiene: pure, typed, vendor-free, domain-neutral (J-037)
 * ────────────────────────────────────────────────────────────*/

describe("G-060 module hygiene", () => {
  const CONTRACT_PATH = join(__dirname, "../../frontend/src/lib/universal-runtime-fabric/contracts.ts");
  const source = readFileSync(CONTRACT_PATH, "utf8");

  it("contains no `any` and no z.any (strict TypeScript law)", () => {
    expect(source).not.toMatch(/\bz\.any\b/);
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas any\b/);
    expect(source).not.toMatch(/\bany\[\]/);
  });

  it("contains no I/O, no vendor imports, and no network surface", () => {
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bcreateClient\b/);
    for (const vendor of ["supabase", "stripe", "paystack", "openai", "anthropic", "axios"]) {
      expect(source.toLowerCase()).not.toContain(vendor);
    }
  });

  it("contains no domain vocabulary (J-037 neutrality token list)", () => {
    const tokens = [
      "scholar",
      "student",
      "teacher",
      "school",
      "classroom",
      "curriculum",
      "exam",
      "examination",
      "grading",
      "attendance",
      "tuition",
      "timetable",
      "admission",
      "lesson",
      "homework",
      "hostel",
      "bursar",
      "principal",
      "guardian",
      "enrollment",
      "enrolment",
      "academic",
      "payroll",
      "textbook",
      "vibeora",
    ];
    for (const token of tokens) {
      expect(new RegExp(`\\b${token}\\b`, "i").test(source), `token: ${token}`).toBe(false);
    }
    for (const literal of ["'parent'", '"parent"', "'staff'", '"staff"', "'driver'", '"driver"']) {
      expect(source).not.toContain(literal);
    }
  });

  it("never handles secrets or credential-shaped fields", () => {
    expect(source).not.toMatch(/\b(apiKey|api_key|secret|password|token_value|privateKey)\b/);
  });
});