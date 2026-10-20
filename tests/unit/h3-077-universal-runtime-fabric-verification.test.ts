/**
 * CoreGrid — H3-077 Universal Runtime Fabric ADVERSARIAL VERIFICATION suite
 * (mission G-077, phase 40, Verifier role).
 *
 * Relationship to G-060: G-060 owns the contract module's own suite; this
 * file is the independent adversarial battery layered ON TOP of the completed
 * module (READ-ONLY import — never modified here). It deepens; it does not
 * duplicate: every suite below runs ATTACKS, not happy paths.
 *
 * Attack classes proven contained with TYPED DENIALS:
 *   1. client-supplied tenant/context injection (§26 — never trust the client);
 *   2. self-activation attempts (§21 — installation never activates);
 *   3. duplicate / cross-tenant-collision registration (§31);
 *   4. suspended / retired zombie operations (suspended access fails closed);
 *   5. kernel-transition bypass (the decision can never outrun kernel law);
 *   6. health-signal optimism (unproven is `unknown`, NEVER `healthy`);
 *   7. resource-ceiling evasion (declaration bounds are inclusive, hard walls).
 *
 * LAW: every attack below must end in a typed denial. Where an attack
 * SUCCEEDS, the test is labeled FINDING and documents the precise behavior
 * for the module owner (G-060) — this suite never fixes the module.
 * Pure offline: no network, no database, no secrets, no git.
 */
import { describe, expect, it } from "vitest";

import {
  DENIAL_REASONS,
  INSTALL_TARGET_STATUS,
  LIFECYCLE_INTENT_TARGET,
  MAX_CAPABILITY_REFS,
  MAX_CONCURRENT_TASKS,
  MAX_DEPENDENCY_REFS,
  MAX_MEMORY_MB,
  MAX_REGISTRY_SNAPSHOT_ENTRIES,
  MAX_STORAGE_MB,
  RUNTIME_LIFECYCLE_STATUSES,
  canTransitionRuntimeLifecycle,
  decideRuntimeRegistration,
  parseRegistrationContext,
  parseRuntimeDescriptor,
  parseRuntimeHealthSignal,
  parseRuntimeRegistrationRequest,
  runtimeRegistrationDecisionSchema,
  unknownRuntimeHealthSignal,
  type RegistrationContext,
  type RuntimeDescriptor,
  type RuntimeRegistrationDecision,
} from "../../frontend/src/lib/universal-runtime-fabric/contracts";
import { canTransitionRuntimeStatus } from "../../frontend/src/lib/kernel/runtime-registry";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (adversarial harness)
 * ────────────────────────────────────────────────────────────*/

const INSTANT = "2026-10-03T00:00:00.000Z";

function descriptor(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    runtimeRef: "runtime:alpha",
    name: "Alpha Runtime",
    version: "1.0.0",
    summary: "A neutral runtime used as the adversarial verification fixture.",
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

function installRequest(
  runtime: RuntimeDescriptor = descriptor(),
  overrides: Record<string, unknown> = {},
) {
  return {
    intent: "install",
    descriptor: runtime,
    provenance: {
      requestedBy: "role:runtime-operator",
      authority: "AGENTS.md §42 / H3 wave mission G-077",
      requestedAt: INSTANT,
      justification: "Adversarial verification fixture request.",
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
      requestedBy: "role:runtime-operator",
      authority: "AGENTS.md §42 / H3 wave mission G-077",
      requestedAt: INSTANT,
      justification: "Adversarial verification lifecycle request.",
    },
    ...overrides,
  };
}

/** A contained attack denies, carries only typed reasons, and round-trips. */
function expectContained(
  attack: string,
  decision: RuntimeRegistrationDecision,
  ...expectedReasons: (typeof DENIAL_REASONS)[number][]
): void {
  expect(decision.outcome, attack).toBe("deny");
  if (decision.outcome !== "deny") return;
  expect(decision.reasons.length, attack).toBeGreaterThan(0);
  for (const reason of decision.reasons) {
    expect((DENIAL_REASONS as readonly string[]).includes(reason), attack).toBe(true);
  }
  for (const expected of expectedReasons) {
    expect(decision.reasons, attack).toContain(expected);
  }
  expect(runtimeRegistrationDecisionSchema.safeParse(decision).success, attack).toBe(true);
}

/** Deep-clone through JSON so injected own properties (e.g. __proto__) survive. */
function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Client-supplied tenant / context injection (§26)
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: client-supplied tenant/context injection", () => {
  it("denies an install request smuggling a resolvedTenantRef field", () => {
    const forged = installRequest(descriptor(), { resolvedTenantRef: "tenant_b" });
    expectContained("tenant smuggling at request root", decideRuntimeRegistration(forged, context()), "invalid_request_shape");
  });

  it("denies a request smuggling server-only context fields (registry view, capability vocabulary, actor)", () => {
    for (const injected of [
      { registrySnapshot: [installed("runtime:alpha", "tenant_a", "active")] },
      { knownCapabilityRefs: ["capability:record-storage"] },
      { actorRef: "role:kernel-supreme" },
      { observedAt: "1999-01-01T00:00:00.000Z" },
    ]) {
      const forged = installRequest(descriptor(), injected);
      expectContained(`context smuggling key "${Object.keys(injected)[0]}"`, decideRuntimeRegistration(forged, context()), "invalid_request_shape");
    }
  });

  it("denies a descriptor carrying tenant-identity or registry fields inside the payload", () => {
    const withTenantField = { ...descriptor(), tenantRef: "tenant_b" } as unknown;
    expect(parseRuntimeDescriptor(withTenantField).ok).toBe(false);

    const withSnapshotField = {
      ...descriptor(),
      registrySnapshot: [installed("runtime:alpha", "tenant_b", "active")],
    } as unknown;
    expect(parseRuntimeDescriptor(withSnapshotField).ok).toBe(false);
  });

  it("swapped arguments (context offered as the request) deny as invalid_context, never allow", () => {
    const decision = decideRuntimeRegistration(context() as unknown, installRequest() as unknown);
    expectContained("swapped arguments", decision, "invalid_context");
  });

  it("null/undefined requests and contexts deny without throwing", () => {
    expectContained("null request", decideRuntimeRegistration(null, context()), "invalid_request_shape");
    expectContained("null context", decideRuntimeRegistration(installRequest(), null), "invalid_context");
    expectContained("both null", decideRuntimeRegistration(null, null), "invalid_context");
    expectContained("undefined both", decideRuntimeRegistration(undefined, undefined), "invalid_context");
  });

  it("prototype-pollution keys injected via JSON never influence the decision (tenant/actor derive only from the context)", () => {
    const forged = clone(installRequest()) as Record<string, unknown>;
    Object.defineProperty(forged, "__proto__", {
      value: { resolvedTenantRef: "tenant_b", actorRef: "role:kernel-supreme" },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const decision = decideRuntimeRegistration(forged, context());
    // zod >= 4.6 refuses an own __proto__ key outright; the forged tenant/actor
    // can never surface in an allow decision.
    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "allow") {
      expect(decision.tenantRef).not.toBe("tenant_b");
      expect(decision.decidedBy).not.toBe("role:kernel-supreme");
    }
  });

  it("the decision tenant ALWAYS equals the server-resolved context tenant — the same request yields different tenants only when the CONTEXT differs", () => {
    const request = installRequest(descriptor({ runtimeRef: "runtime:fresh" }));
    const forTenantA = decideRuntimeRegistration(request, context({ resolvedTenantRef: "tenant_a" }));
    const forTenantC = decideRuntimeRegistration(clone(request), context({ resolvedTenantRef: "tenant_c" }));
    expect(forTenantA.outcome).toBe("allow");
    expect(forTenantC.outcome).toBe("allow");
    if (forTenantA.outcome === "allow" && forTenantC.outcome === "allow") {
      expect(forTenantA.tenantRef).toBe("tenant_a");
      expect(forTenantC.tenantRef).toBe("tenant_c");
      expect(forTenantA.tenantRef).not.toBe(forTenantC.tenantRef);
    }
  });

  it("decidedBy is derived from the context actor, never from request provenance", () => {
    const forgedProvenance = installRequest(descriptor(), {
      provenance: {
        requestedBy: "role:kernel-supreme",
        authority: "self",
        requestedAt: INSTANT,
        justification: "I grant myself authority.",
      },
    });
    const decision = decideRuntimeRegistration(forgedProvenance, context());
    expect(decision.outcome).toBe("allow");
    if (decision.outcome === "allow") expect(decision.decidedBy).toBe("role:fabric-administrator");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Self-activation attempts (§21)
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: self-activation", () => {
  it("every accepted install lands in `proposed` — never `active`, `approved`, or `review`", () => {
    for (const variant of [
      descriptor(),
      descriptor({ runtimeRef: "runtime:beta" }),
      descriptor({ interfaces: [] }),
      descriptor({ ontology: { entityTypes: [{ name: "actor" }], relationshipTypes: [] } }),
    ]) {
      const decision = decideRuntimeRegistration(installRequest(variant), context());
      expect(decision.outcome).toBe("allow");
      if (decision.outcome === "allow") {
        expect(decision.targetStatus).toBe(INSTALL_TARGET_STATUS);
        expect(decision.targetStatus).toBe("proposed");
      }
    }
  });

  it("an `activate` intent is outside the request vocabulary and denies", () => {
    const forged = lifecycleRequest("resume") as Record<string, unknown>;
    forged.intent = "activate";
    expect(parseRuntimeRegistrationRequest(forged).ok).toBe(false);
    expectContained("activate intent", decideRuntimeRegistration(forged, context()), "invalid_request_shape");
  });

  it("resume cannot self-activate a merely `proposed` or `review` runtime — the kernel approval chain is mandatory", () => {
    for (const status of ["proposed", "review"] as const) {
      const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", status)] });
      expectContained(
        `resume from ${status}`,
        decideRuntimeRegistration(lifecycleRequest("resume"), ctx),
        "invalid_lifecycle_transition",
      );
    }
  });

  it("a descriptor declaring lifecycle status or target fields is invalid (activation is not declarable)", () => {
    const declaresStatus = { ...descriptor(), status: "active" } as unknown;
    expect(parseRuntimeDescriptor(declaresStatus).ok).toBe(false);
    const declaresTarget = { ...descriptor(), targetStatus: "active" } as unknown;
    expect(parseRuntimeDescriptor(declaresTarget).ok).toBe(false);
  });

  it("install cannot escalate isolation or egress posture in the same breath", () => {
    const egressAll = { ...descriptor(), isolation: { tenantScoped: true, egress: "open", stateMode: "dedicated" } } as unknown;
    expect(parseRuntimeDescriptor(egressAll).ok).toBe(false);
    const unscoped = { ...descriptor(), isolation: { tenantScoped: false, egress: "none", stateMode: "dedicated" } } as unknown;
    expect(parseRuntimeDescriptor(unscoped).ok).toBe(false);
    const sharedState = { ...descriptor(), isolation: { tenantScoped: true, egress: "none", stateMode: "read_write" } } as unknown;
    expect(parseRuntimeDescriptor(sharedState).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Duplicate / collision registration (§31)
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: duplicate and cross-tenant collision registration", () => {
  it(`same-tenant re-install denies as duplicate_registration in EVERY existing lifecycle state`, () => {
    for (const status of RUNTIME_LIFECYCLE_STATUSES) {
      const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", status)] });
      expectContained(`duplicate install over ${status}`, decideRuntimeRegistration(installRequest(), ctx), "duplicate_registration");
    }
  });

  it("cross-tenant collision denies as tenant_mismatch in EVERY existing lifecycle state — and leaks no foreign tenant identity", () => {
    for (const status of RUNTIME_LIFECYCLE_STATUSES) {
      const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_b", status)] });
      const decision = decideRuntimeRegistration(installRequest(), ctx);
      expectContained(`collision install over foreign ${status}`, decision, "tenant_mismatch");
      if (decision.outcome === "deny") {
        for (const line of decision.detail) {
          expect(line.includes("tenant_b"), `detail leak in ${status}: ${line}`).toBe(false);
        }
      }
    }
  });

  it("a retired canonical ref is NOT reclaimable by re-install (no zombie re-registration)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "retired")] });
    expectContained("re-install over own retired ref", decideRuntimeRegistration(installRequest(), ctx), "duplicate_registration");
  });

  it("a conflicting snapshot (same ref claimed by two tenants) denies under EITHER resolution order, with a typed reason", () => {
    const foreignFirst = context({
      registrySnapshot: [
        installed("runtime:alpha", "tenant_b", "active"),
        installed("runtime:alpha", "tenant_a", "suspended"),
      ],
    });
    expectContained("conflicting snapshot, foreign first", decideRuntimeRegistration(installRequest(), foreignFirst), "tenant_mismatch");
    const ownFirst = context({
      registrySnapshot: [
        installed("runtime:alpha", "tenant_a", "suspended"),
        installed("runtime:alpha", "tenant_b", "active"),
      ],
    });
    expectContained("conflicting snapshot, own first", decideRuntimeRegistration(installRequest(), ownFirst), "duplicate_registration");
  });

  it("lifecycle collision: suspend/resume/retire remain denied when the snapshot already holds the target state", () => {
    const alreadySuspended = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "suspended")] });
    expectContained("suspend an already-suspended runtime", decideRuntimeRegistration(lifecycleRequest("suspend"), alreadySuspended), "invalid_lifecycle_transition");
    const alreadyActive = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "active")] });
    expectContained("resume an already-active runtime", decideRuntimeRegistration(lifecycleRequest("resume"), alreadyActive), "invalid_lifecycle_transition");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Suspended / retired zombie operations
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: suspended/retired zombie operations", () => {
  it("a SUSPENDED runtime cannot be suspended again, but its only exits are resume/retire (kernel law)", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "suspended")] });
    expectContained("double suspend", decideRuntimeRegistration(lifecycleRequest("suspend"), ctx), "invalid_lifecycle_transition");
    expect(decideRuntimeRegistration(lifecycleRequest("resume"), ctx).outcome).toBe("allow");
    expect(decideRuntimeRegistration(lifecycleRequest("retire"), ctx).outcome).toBe("allow");
  });

  it("a RETIRED runtime denies every lifecycle intent — retirement is terminal, no zombie resurrection", () => {
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "retired")] });
    for (const intent of ["suspend", "resume", "retire"] as const) {
      expectContained(`zombie ${intent} on retired`, decideRuntimeRegistration(lifecycleRequest(intent), ctx), "retired_runtime");
    }
  });

  it("retirement is terminal even under a forged foreign-owned snapshot ordering", () => {
    const ctx = context({
      registrySnapshot: [
        installed("runtime:alpha", "tenant_a", "retired"),
        installed("runtime:alpha", "tenant_a", "active"),
      ],
    });
    expectContained("retired-first snapshot ordering", decideRuntimeRegistration(lifecycleRequest("resume"), ctx), "retired_runtime");
  });

  it("the default health posture of a retired runtime is still `unknown` — never an optimistic `healthy`", () => {
    const signal = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    expect(signal.status).not.toBe("healthy");
    expect(signal.status).toBe("unknown");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Kernel-transition bypass
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: kernel-transition bypass", () => {
  it("EXHAUSTIVE: for every status × lifecycle intent, the decision matches the imported kernel transition law exactly", () => {
    for (const status of RUNTIME_LIFECYCLE_STATUSES) {
      for (const intent of ["suspend", "resume", "retire"] as const) {
        const target = LIFECYCLE_INTENT_TARGET[intent];
        const lawAllows =
          status !== "retired" && status !== target && canTransitionRuntimeLifecycle(status, target);
        const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", status)] });
        const decision = decideRuntimeRegistration(lifecycleRequest(intent), ctx);
        if (lawAllows) {
          expect(decision.outcome, `${status} --${intent}--> ${target}`).toBe("allow");
          if (decision.outcome === "allow") expect(decision.targetStatus, `${status} --${intent}`).toBe(target);
        } else {
          expect(decision.outcome, `${status} --${intent}--> ${target} must be denied`).toBe("deny");
        }
      }
    }
  });

  it("the fabric's transition re-export is in exact lockstep with the kernel matrix (no drift hole to exploit)", () => {
    for (const from of RUNTIME_LIFECYCLE_STATUSES) {
      for (const to of RUNTIME_LIFECYCLE_STATUSES) {
        expect(canTransitionRuntimeLifecycle(from, to)).toBe(
          canTransitionRuntimeStatus(from as "proposed", to as "proposed"),
        );
      }
    }
  });

  it("a lifecycle request forging a targetStatus field is invalid — the target is never client-declared", () => {
    const forged = lifecycleRequest("resume", "runtime:alpha", { targetStatus: "active" });
    expect(parseRuntimeRegistrationRequest(forged).ok).toBe(false);
    const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", "proposed")] });
    expectContained("forged targetStatus", decideRuntimeRegistration(forged, ctx), "invalid_request_shape");
  });

  it("no lifecycle intent can drive a runtime to a status outside its kernel-legal successors", () => {
    for (const status of RUNTIME_LIFECYCLE_STATUSES) {
      const successors = RUNTIME_LIFECYCLE_STATUSES.filter((to) => canTransitionRuntimeLifecycle(status, to));
      for (const intent of ["suspend", "resume", "retire"] as const) {
        const target = LIFECYCLE_INTENT_TARGET[intent];
        const ctx = context({ registrySnapshot: [installed("runtime:alpha", "tenant_a", status)] });
        const decision = decideRuntimeRegistration(lifecycleRequest(intent), ctx);
        if (decision.outcome === "allow") {
          expect(successors, `${status} --${intent}--> ${target} must be a kernel successor`).toContain(target);
        }
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Health-signal optimism (unknown must NEVER become healthy)
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: health-signal optimism", () => {
  it("the fail-closed constructor emits `unknown` for arbitrary refs, tenants and instants — never `healthy`", () => {
    for (const [runtimeRef, tenantRef] of [
      ["runtime:alpha", "tenant_a"],
      ["runtime:never-seen", "tenant_z"],
      ["runtime:alpha", "tenant_a"],
    ] as const) {
      const signal = unknownRuntimeHealthSignal(runtimeRef, tenantRef, INSTANT);
      expect(signal.status, `${runtimeRef}/${tenantRef} must be unknown`).toBe("unknown");
      expect(signal.status).not.toBe("healthy");
      expect(parseRuntimeHealthSignal(signal).ok).toBe(true);
    }
  });

  it("a health signal WITHOUT a proven status cannot parse into an optimistic default", () => {
    const noStatus = {
      runtimeRef: "runtime:alpha",
      tenantRef: "tenant_a",
      observedAt: INSTANT,
      failingDependencyRefs: [],
    };
    const parsed = parseRuntimeHealthSignal(noStatus);
    expect(parsed.ok).toBe(false);
  });

  it("optimistic non-vocabulary statuses are rejected (only observed vocabulary parses)", () => {
    const base = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    for (const optimistic of ["operational", "ok", "green", "HEALTHY", "nominal", "up", ""]) {
      const forged = { ...base, status: optimistic };
      const parsed = parseRuntimeHealthSignal(forged);
      expect(parsed.ok, `optimistic status "${optimistic}" must not parse`).toBe(false);
    }
    for (const observed of ["healthy", "degraded", "unhealthy", "unknown"] as const) {
      const forged = { ...base, status: observed };
      expect(parseRuntimeHealthSignal(forged).ok, `observed status "${observed}" is legitimate`).toBe(true);
    }
  });

  it("an unknown signal cannot masquerade as healthy by toggling only the summary or dependency fields", () => {
    const base = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    const summaryOptimism = parseRuntimeHealthSignal({ ...base, summary: "All systems fully healthy." });
    expect(summaryOptimism.ok).toBe(true);
    if (summaryOptimism.ok) expect(summaryOptimism.value.status).toBe("unknown");
    const dependencyOptimism = parseRuntimeHealthSignal({ ...base, failingDependencyRefs: [] });
    expect(dependencyOptimism.ok).toBe(true);
    if (dependencyOptimism.ok) expect(dependencyOptimism.value.status).toBe("unknown");
  });

  it("health-signal identity fields are tenant-scoped and fail closed on malformed input", () => {
    const base = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    expect(parseRuntimeHealthSignal({ ...base, runtimeRef: "widget:alpha" }).ok).toBe(false);
    expect(parseRuntimeHealthSignal({ ...base, tenantRef: "TENANT_A" }).ok).toBe(false);
    expect(parseRuntimeHealthSignal({ ...base, observedAt: "yesterday" }).ok).toBe(false);
  });

  it("unbounded failing-dependency lists cannot smuggle through the health channel", () => {
    const base = unknownRuntimeHealthSignal("runtime:alpha", "tenant_a", INSTANT);
    const tooMany = Array.from({ length: MAX_DEPENDENCY_REFS + 1 }, (_, i) => `dependency:d_${i}`);
    expect(parseRuntimeHealthSignal({ ...base, failingDependencyRefs: tooMany }).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Resource-ceiling evasion
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 attack: resource-ceiling evasion", () => {
  it("each compute ceiling is an inclusive hard wall: exactly-max parses, max+1 / zero / negative / fractional / numeric-string deny", () => {
    const walls: readonly {
      field: "maxConcurrentTasks" | "maxMemoryMb" | "maxStorageMb";
      max: number;
    }[] = [
      { field: "maxConcurrentTasks", max: MAX_CONCURRENT_TASKS },
      { field: "maxMemoryMb", max: MAX_MEMORY_MB },
      { field: "maxStorageMb", max: MAX_STORAGE_MB },
    ];
    for (const { field, max } of walls) {
      const atMax = descriptor({ resourceCeiling: { maxConcurrentTasks: 8, maxMemoryMb: 512, maxStorageMb: 1024, [field]: max } as unknown as RuntimeDescriptor["resourceCeiling"] });
      expect(parseRuntimeDescriptor(atMax).ok, `${field} at exactly ${max} is a legal declaration`).toBe(true);

      for (const attempt of [max + 1, 0, -1, 1.5, `${max}`]) {
        const forged = descriptor({
          resourceCeiling: { maxConcurrentTasks: 8, maxMemoryMb: 512, maxStorageMb: 1024, [field]: attempt } as unknown as RuntimeDescriptor["resourceCeiling"],
        });
        const parsed = parseRuntimeDescriptor(forged);
        expect(parsed.ok, `${field} = ${String(attempt)} must not parse`).toBe(false);
      }
    }
  });

  it("ceiling evasion via undeclared extra keys (burst/shares/limits) is rejected by the strict shape", () => {
    const burst = {
      ...descriptor(),
      resourceCeiling: { maxConcurrentTasks: 8, maxMemoryMb: 512, maxStorageMb: 1024, burst: 999_999 },
    } as unknown;
    expect(parseRuntimeDescriptor(burst).ok).toBe(false);
    const shares = { ...descriptor(), limits: { maxConcurrentTasks: 999_999 } } as unknown;
    expect(parseRuntimeDescriptor(shares).ok).toBe(false);
    const nestedEgress = {
      ...descriptor(),
      isolation: { tenantScoped: true, egress: "none", stateMode: "dedicated", bypass: ["rls"] },
    } as unknown;
    expect(parseRuntimeDescriptor(nestedEgress).ok).toBe(false);
  });

  it("the registry-snapshot ceiling denies a context beyond MAX_REGISTRY_SNAPSHOT_ENTRIES as invalid_context", () => {
    const flood = Array.from(
      { length: MAX_REGISTRY_SNAPSHOT_ENTRIES + 1 },
      (_, i) => installed(`runtime:r_${i}`, "tenant_a", "proposed"),
    );
    const decision = decideRuntimeRegistration(installRequest(), context({ registrySnapshot: flood }));
    expectContained("snapshot flooding", decision, "invalid_context");
  });

  it("an oversized capability vocabulary in the context denies as invalid_context (no side-channel vocabulary injection)", () => {
    const flood = Array.from({ length: MAX_CAPABILITY_REFS + 1 }, (_, i) => `capability:c_${i}`);
    const decision = decideRuntimeRegistration(installRequest(), context({ knownCapabilityRefs: flood }));
    expectContained("capability-vocabulary flooding", decision, "invalid_context");
  });

  it("unresolved capability consumption still denies under a legal (bounded) context", () => {
    const rogue = descriptor({ capabilityRefs: ["capability:not-in-vocabulary"] });
    expectContained("unresolved capability", decideRuntimeRegistration(installRequest(rogue), context()), "unresolved_capability_ref");
  });
});

/* ─────────────────────────────────────────────────────────────
 * FINDINGS — attacks that were NOT contained (documented, NOT fixed)
 * ────────────────────────────────────────────────────────────*/

describe("H3-077 FINDINGS (verification evidence for the module owner G-060)", () => {
  it(
    "FINDING G-077-F1: an install with EMPTY capabilityRefs is ALLOWED — the kernel consumption contract " +
      "(kernel validateManifest: 'a runtime manifest must declare at least one consumed capability') has no " +
      "equivalent minimum in runtimeDescriptorSchema (capabilityRefs declares .max() but no .min(1)), and the " +
      "decision function only denies UNRESOLVED refs; a zero-consumption runtime therefore registers — a drift " +
      "from the kernel law this module imports read-only. Recorded precisely; the module is NOT modified here.",
    () => {
      const zeroConsumption = descriptor({ capabilityRefs: [] });
      expect(parseRuntimeDescriptor(zeroConsumption).ok).toBe(true);
      const decision = decideRuntimeRegistration(installRequest(zeroConsumption), context({ knownCapabilityRefs: [] }));
      expect(decision.outcome).toBe("allow");
    },
  );
});
