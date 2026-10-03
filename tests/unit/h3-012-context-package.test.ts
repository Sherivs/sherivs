/**
 * CoreGrid — H3-012 context-package completeness tests (mission B-012, J-011).
 *
 * Proves that a context package is accepted ONLY when `memory_scope`,
 * `data_scope`, `risk_level` and `trace_id` are all present and well-formed;
 * that every incompleteness is named per field (fail-closed, never a bare
 * boolean); and that the governed assembler's envelopes (`context-assembly`,
 * read-only) satisfy the completeness contract — declared and derived.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  COMPLETENESS_FIELDS,
  checkContextPackageCompleteness,
  checkEnvelopeCompleteness,
  contextPackageSchema,
  scopeRecordSchema,
  traceIdSchema,
  wirePackageFromEnvelope,
  type ContextPackage,
  type CompletenessField,
} from "../../frontend/src/lib/context/package-completeness";
import {
  assembleContext,
  contextPayload,
  type ContextAssemblyConfig,
  type ContextCandidate,
  type ContextRequest,
} from "../../frontend/src/lib/context-assembly";

const NOW = "2026-10-03T00:00:00.000Z";
const CONFIG: ContextAssemblyConfig = { maxAgeSeconds: 60, now: NOW };

/** A package carrying all four fields, well-formed (declared-scope shape). */
function completePackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    memory_scope: { domains: ["session_memory"], max_sensitivity: "internal", origin: "declared" },
    data_scope: { domains: ["authorized_records"], max_sensitivity: "restricted", origin: "declared" },
    risk_level: { level: "high", origin: "declared" },
    trace_id: "ctx-trace-1a2b3c4d",
    ...overrides,
  };
}

function fieldIsMissing(field: CompletenessField, raw: Record<string, unknown>): boolean {
  const verdict = checkContextPackageCompleteness(raw);
  return !verdict.ok && verdict.reason === "incomplete" && verdict.missing.includes(field);
}

function firstMalformedField(raw: Record<string, unknown>): CompletenessField | null {
  const verdict = checkContextPackageCompleteness(raw);
  if (verdict.ok || verdict.reason !== "incomplete") return null;
  return verdict.malformed[0]?.field ?? null;
}

describe("complete packages are accepted", () => {
  it("accepts a fully scoped package with all four fields well-formed", () => {
    const verdict = checkContextPackageCompleteness(completePackage());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.package.memory_scope.domains).toEqual(["session_memory"]);
      expect(verdict.package.data_scope.max_sensitivity).toBe("restricted");
      expect(verdict.package.risk_level).toEqual({ level: "high", origin: "declared" });
      expect(verdict.package.trace_id).toBe("ctx-trace-1a2b3c4d");
    }
  });

  it("accepts a derived-scope package with an explicitly empty memory scope", () => {
    const derived: ContextPackage = {
      memory_scope: { domains: [], max_sensitivity: "public", origin: "derived" },
      data_scope: { domains: ["system_policy"], max_sensitivity: "public", origin: "derived" },
      risk_level: { level: "medium", origin: "derived" },
      trace_id: "ctx-trace-deadbeef",
    };
    expect(checkContextPackageCompleteness(derived).ok).toBe(true);
  });

  it("accepts caller-supplied correlation ids (UUID-shaped) as trace ids", () => {
    const verdict = checkContextPackageCompleteness(
      completePackage({ trace_id: "0f0e1d2c-3b4a-5968-7766-554433221100" }),
    );
    expect(verdict.ok).toBe(true);
  });

  it("accepts the maximum bounds (64 domains, 128-char trace id)", () => {
    const many = Array.from({ length: 64 }, (_, i) => `domain_${i}`);
    const verdict = checkContextPackageCompleteness(
      completePackage({
        memory_scope: { domains: many, max_sensitivity: "internal", origin: "declared" },
        trace_id: "t".repeat(128),
      }),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("missing fields fail closed and are named exactly", () => {
  it("rejects a package with any one of the four fields absent", () => {
    for (const field of COMPLETENESS_FIELDS) {
      const raw = completePackage();
      delete raw[field];
      const verdict = checkContextPackageCompleteness(raw);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe("incomplete");
        expect(verdict.missing).toEqual([field]);
        expect(verdict.malformed).toEqual([]);
      }
    }
  });

  it("treats an explicitly undefined field as missing, not malformed", () => {
    expect(fieldIsMissing("trace_id", completePackage({ trace_id: undefined }))).toBe(true);
    expect(fieldIsMissing("memory_scope", completePackage({ memory_scope: undefined }))).toBe(true);
  });

  it("rejects an empty object — nothing is implicitly complete", () => {
    const verdict = checkContextPackageCompleteness({});
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.missing).toEqual([...COMPLETENESS_FIELDS]);
    }
  });
});

describe("malformed fields fail closed and are attributed", () => {
  it("rejects an out-of-vocabulary sensitivity on a scope record", () => {
    expect(
      firstMalformedField(
        completePackage({
          memory_scope: { domains: [], max_sensitivity: "secret", origin: "declared" },
        }),
      ),
    ).toBe("memory_scope");
  });

  it("rejects an out-of-vocabulary risk level and origin", () => {
    expect(
      firstMalformedField(completePackage({ risk_level: { level: "catastrophic", origin: "declared" } })),
    ).toBe("risk_level");
    expect(
      firstMalformedField(completePackage({ risk_level: { level: "high", origin: "inherited" } })),
    ).toBe("risk_level");
  });

  it("rejects a bare-string risk level — the assessment must state its origin", () => {
    expect(firstMalformedField(completePackage({ risk_level: "high" }))).toBe("risk_level");
  });

  it("rejects an out-of-vocabulary scope origin", () => {
    expect(
      firstMalformedField(
        completePackage({
          data_scope: { domains: [], max_sensitivity: "public", origin: "assumed" },
        }),
      ),
    ).toBe("data_scope");
  });

  it("rejects a null field as malformed, not missing", () => {
    const verdict = checkContextPackageCompleteness(completePackage({ trace_id: null }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.missing).toEqual([]);
      expect(verdict.malformed[0]?.field).toBe("trace_id");
    }
  });

  it("rejects empty, whitespace-bearing, oversized, and non-token trace ids", () => {
    for (const bad of ["", "   ", "has space", `${"t".repeat(129)}`, "id/slash", "-leading-dash"]) {
      expect(traceIdSchema.safeParse(bad).success).toBe(false);
      expect(firstMalformedField(completePackage({ trace_id: bad }))).toBe("trace_id");
    }
  });

  it("rejects empty-string, whitespace-bearing, and oversized domains", () => {
    for (const bad of ["", "   ", "has space", `${"d".repeat(129)}`, "d/slash"]) {
      expect(
        scopeRecordSchema.safeParse({ domains: [bad], max_sensitivity: "public", origin: "derived" })
          .success,
      ).toBe(false);
    }
  });

  it("rejects duplicate domains — the scope statement stays canonical", () => {
    const verdict = checkContextPackageCompleteness(
      completePackage({
        data_scope: {
          domains: ["records", "records"],
          max_sensitivity: "restricted",
          origin: "declared",
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.malformed[0]?.field).toBe("data_scope");
      expect(verdict.malformed[0]?.message).toContain("duplicate");
    }
  });

  it("rejects arrays in place of scope records and trace ids", () => {
    expect(firstMalformedField(completePackage({ memory_scope: ["session_memory"] }))).toBe(
      "memory_scope",
    );
    expect(firstMalformedField(completePackage({ trace_id: ["ctx-trace-1a2b3c4d"] }))).toBe(
      "trace_id",
    );
  });

  it("rejects more than 64 domains in one scope statement", () => {
    const many = Array.from({ length: 65 }, (_, i) => `domain_${i}`);
    expect(
      scopeRecordSchema.safeParse({ domains: many, max_sensitivity: "public", origin: "derived" })
        .success,
    ).toBe(false);
  });
});

describe("closed shapes — undeclared semantics cannot leak in", () => {
  it("rejects unknown keys inside a scope record", () => {
    expect(
      firstMalformedField(
        completePackage({
          memory_scope: {
            domains: [],
            max_sensitivity: "public",
            origin: "derived",
            wildcard: true,
          },
        }),
      ),
    ).toBe("memory_scope");
  });

  it("rejects unknown keys inside the risk assessment", () => {
    expect(
      firstMalformedField(
        completePackage({ risk_level: { level: "low", origin: "declared", note: "x" } }),
      ),
    ).toBe("risk_level");
  });

  it("rejects unknown keys at the package level (strict full parse)", () => {
    const verdict = checkContextPackageCompleteness(completePackage({ extra: true }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("invalid_shape");
      expect(verdict.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-object inputs with every field reported missing", () => {
    for (const bad of [null, undefined, 42, "package", [], true]) {
      const verdict = checkContextPackageCompleteness(bad);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe("invalid_shape");
        expect(verdict.missing).toEqual([...COMPLETENESS_FIELDS]);
      }
    }
  });
});

describe("the governed assembler satisfies the completeness contract (read-only proof)", () => {
  const actorRef = { userId: "user-1", role: "observer", permissions: ["context.read"] };

  const declaredRequest: ContextRequest = {
    tenantRef: "tenant-a",
    actorRef,
    purpose: "verify scope statements",
    missionRef: null,
    budget: { maxItems: 5, maxChars: 1000 },
    candidateSources: [],
    memoryScope: { domains: ["session_memory"], maxSensitivity: "internal" },
    dataScope: { domains: ["authorized_records"], maxSensitivity: "restricted" },
    riskLevel: "high",
    traceId: "ctx-trace-1a2b3c4d",
  };

  const candidate: ContextCandidate = {
    id: "cand-1",
    tenantRef: "tenant-a",
    source: "system_policy",
    sensitivity: "internal",
    freshnessAt: NOW,
    content: contextPayload("policy fragment"),
    requiredPermission: null,
    purposeTags: ["scope"],
  };

  it("declared scopes, declared risk and the caller trace id parse complete", () => {
    const envelope = assembleContext(declaredRequest, [candidate], CONFIG);
    expect(envelope.kind).toBe("assembled");
    const verdict = checkEnvelopeCompleteness(envelope);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.package.memory_scope).toEqual({
        domains: ["session_memory"],
        max_sensitivity: "internal",
        origin: "declared",
      });
      expect(verdict.package.data_scope.origin).toBe("declared");
      expect(verdict.package.risk_level).toEqual({ level: "high", origin: "declared" });
      expect(verdict.package.trace_id).toBe("ctx-trace-1a2b3c4d");
    }
  });

  it("derived scopes and the deterministic trace id also parse complete", () => {
    const envelope = assembleContext(
      { ...declaredRequest, memoryScope: undefined, dataScope: undefined, riskLevel: undefined, traceId: undefined },
      [candidate],
      CONFIG,
    );
    expect(envelope.kind).toBe("assembled");
    const verdict = checkEnvelopeCompleteness(envelope);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.package.memory_scope).toEqual({
        domains: [],
        max_sensitivity: "public",
        origin: "derived",
      });
      expect(verdict.package.risk_level.origin).toBe("derived");
      expect(verdict.package.trace_id).toMatch(/^ctx-trace-[0-9a-f]{8}$/);
    }
  });

  it("a rejected envelope has no scope statement and fails closed", () => {
    const envelope = assembleContext(
      { ...declaredRequest, budget: { maxItems: 0, maxChars: 1000 } },
      [candidate],
      CONFIG,
    );
    expect(envelope.kind).toBe("rejected");
    expect(wirePackageFromEnvelope(envelope)).toBeNull();
    const verdict = checkEnvelopeCompleteness(envelope);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.missing).toEqual([...COMPLETENESS_FIELDS]);
    }
  });

  it("every assembled envelope carries all four fields on the package itself", () => {
    const envelope = assembleContext(declaredRequest, [candidate], CONFIG);
    if (envelope.kind !== "assembled") {
      expect.unreachable("assembly should not be rejected");
    }
    for (const wireField of ["memoryScope", "dataScope", "riskLevel", "traceId"] as const) {
      expect(envelope[wireField]).toBeDefined();
    }
  });
});

describe("module hygiene", () => {
  it("declares exactly the four completeness fields, in contract order", () => {
    expect([...COMPLETENESS_FIELDS]).toEqual([
      "memory_scope",
      "data_scope",
      "risk_level",
      "trace_id",
    ]);
  });

  it("exposes the package schema for downstream consumers", () => {
    expect(typeof contextPackageSchema.safeParse).toBe("function");
    expect(contextPackageSchema.safeParse(completePackage()).success).toBe(true);
    expect(contextPackageSchema.safeParse({}).success).toBe(false);
  });
});