/**
 * CoreGrid — H3-002 recovery-targets contract tests (mission A-002).
 * Zod validation of RTO/RPO declarations per record family, registry
 * cross-record invariants, and fail-closed resolution/coverage semantics.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  FAIL_CLOSED_UNDECLARED_DETAIL,
  RPO_CEILING_MINUTES,
  RTO_CEILING_MINUTES,
  coverageForFamilies,
  coverageGaps,
  effectiveEnvelope,
  parseRecoveryTargets,
  recoveryTargetDeclarationSchema,
  recoveryTargetRegistrySchema,
  resolveRecoveryTarget,
  undeclaredFamilies,
  type RecordFamily,
} from "../../frontend/src/lib/reliability/recovery-targets";

const DECLARED_AT = "2026-10-03T00:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:recovery-targets-engineer",
  authority: "AGENTS.md §42 / H3 wave mission A-002",
  declaredAt: DECLARED_AT,
};

function declaration(family: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordFamily: family,
    rtoMinutes: 60,
    rpoMinutes: 15,
    provenance: PROVENANCE,
    ...overrides,
  };
}

const FAMILIES: readonly RecordFamily[] = ["event_ledger", "identity_record", "audit_trail"];

const VALID_REGISTRY = {
  envelope: { maxRtoMinutes: 240, maxRpoMinutes: 60 },
  declarations: [
    declaration("event_ledger", { rtoMinutes: 60, rpoMinutes: 15 }),
    declaration("identity_record", { rtoMinutes: 240, rpoMinutes: 60 }),
  ],
};

describe("RTO/RPO declaration schema", () => {
  it("accepts a complete declaration with both objectives and provenance", () => {
    const parsed = recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger"));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rtoMinutes).toBe(60);
      expect(parsed.data.rpoMinutes).toBe(15);
      expect(parsed.data.provenance.declaredBy).toBe("role:recovery-targets-engineer");
    }
  });

  it("rejects partial commitments — an RTO without an RPO is not a commitment", () => {
    const partial = declaration("event_ledger");
    delete partial.rpoMinutes;
    const parsed = recoveryTargetDeclarationSchema.safeParse(partial);
    expect(parsed.success).toBe(false);
  });

  it("rejects anonymous commitments — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = declaration("event_ledger");
    delete anonymous.provenance;
    expect(recoveryTargetDeclarationSchema.safeParse(anonymous).success).toBe(false);

    const blankBy = declaration("event_ledger", {
      provenance: { ...PROVENANCE, declaredBy: "   " },
    });
    expect(recoveryTargetDeclarationSchema.safeParse(blankBy).success).toBe(false);

    const badTimestamp = declaration("event_ledger", {
      provenance: { ...PROVENANCE, declaredAt: "not-a-timestamp" },
    });
    expect(recoveryTargetDeclarationSchema.safeParse(badTimestamp).success).toBe(false);
  });

  it("rejects non-positive and non-integer durations", () => {
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rtoMinutes: 0 })).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rtoMinutes: -5 })).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rpoMinutes: 0.5 })).success).toBe(false);
  });

  it("rejects durations above the hard ceilings — no unbounded commitments", () => {
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rtoMinutes: RTO_CEILING_MINUTES + 1 })).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rpoMinutes: RPO_CEILING_MINUTES + 1 })).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("event_ledger", { rtoMinutes: RTO_CEILING_MINUTES, rpoMinutes: RPO_CEILING_MINUTES })).success).toBe(true);
  });

  it("rejects malformed record families", () => {
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("Event_Ledger")).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("")).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("1_ledger")).success).toBe(false);
    expect(recoveryTargetDeclarationSchema.safeParse(declaration("has space")).success).toBe(false);
  });

  it("rejects unknown keys (strict shape) so undeclared semantics cannot leak in", () => {
    const extra = declaration("event_ledger", { defaultCovered: true });
    const parsed = recoveryTargetDeclarationSchema.safeParse(extra);
    expect(parsed.success).toBe(false);
  });
});

describe("registry parsing (fail-closed, no partial results)", () => {
  it("parses a valid registry with envelope and declarations", () => {
    const result = parseRecoveryTargets(VALID_REGISTRY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry.declarations).toHaveLength(2);
      expect(result.registry.envelope).toEqual({ maxRtoMinutes: 240, maxRpoMinutes: 60 });
    }
  });

  it("rejects non-object and malformed inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "registry", [], [declaration("event_ledger")]]) {
      const result = parseRecoveryTargets(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_shape");
        expect(result.issues.length).toBeGreaterThan(0);
        expect(typeof result.issues[0].path).toBe("string");
        expect(typeof result.issues[0].message).toBe("string");
      }
    }
  });

  it("rejects duplicate record families — one family, one binding", () => {
    const result = parseRecoveryTargets({
      declarations: [declaration("event_ledger"), declaration("event_ledger", { rtoMinutes: 120 })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues[0].message).toContain("duplicate");
    }
  });

  it("rejects declarations that breach the registry envelope", () => {
    const result = parseRecoveryTargets({
      envelope: { maxRtoMinutes: 30, maxRpoMinutes: 10 },
      declarations: [declaration("event_ledger", { rtoMinutes: 60, rpoMinutes: 15 })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues.map((i) => i.path)).toContain("declarations[recordFamily=event_ledger].rtoMinutes");
      expect(result.issues.map((i) => i.path)).toContain("declarations[recordFamily=event_ledger].rpoMinutes");
    }
  });

  it("accepts a registry without an envelope (global ceilings apply)", () => {
    const result = parseRecoveryTargets({ declarations: [declaration("audit_trail")] });
    expect(result.ok).toBe(true);
  });

  it("rejects an envelope looser than the global ceilings", () => {
    const result = parseRecoveryTargets({
      envelope: { maxRtoMinutes: RTO_CEILING_MINUTES + 1, maxRpoMinutes: RPO_CEILING_MINUTES },
      declarations: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });

  it("rejects registries above the bounded declaration count", () => {
    const many = Array.from({ length: 1_025 }, (_, i) => declaration(`family_${i}`));
    const result = parseRecoveryTargets({ declarations: many });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });
});

describe("resolution (fail-closed defaults)", () => {
  const parsed = parseRecoveryTargets(VALID_REGISTRY);
  const registry = parsed.ok ? parsed.registry : null;
  expect(registry).not.toBeNull();

  it("resolves a declared family to its declaration", () => {
    const resolution = resolveRecoveryTarget(registry as NonNullable<typeof registry>, "event_ledger");
    expect(resolution.status).toBe("declared");
    if (resolution.status === "declared") {
      expect(resolution.declaration.rtoMinutes).toBe(60);
      expect(resolution.declaration.rpoMinutes).toBe(15);
    }
  });

  it("resolves an undeclared family to the fail-closed undeclared posture — never a permissive default", () => {
    const resolution = resolveRecoveryTarget(registry as NonNullable<typeof registry>, "audit_trail");
    expect(resolution.status).toBe("undeclared");
    if (resolution.status === "undeclared") {
      expect(resolution.reason).toBe("no_declaration_for_family");
      expect(resolution.detail).toBe(FAIL_CLOSED_UNDECLARED_DETAIL);
      expect(resolution.detail).toContain("no recovery commitment is assumed");
    }
  });

  it("never invents a default target for an unknown family", () => {
    const resolution = resolveRecoveryTarget(registry as NonNullable<typeof registry>, "no_such_family");
    expect((resolution as { status: string }).status).not.toBe("declared");
    const asDeclared = resolution as { declaration?: unknown };
    expect(asDeclared.declaration).toBeUndefined();
  });
});

describe("coverage (gaps are named, never silent)", () => {
  const parsed = parseRecoveryTargets(VALID_REGISTRY);
  const registry = parsed.ok ? parsed.registry : null;
  expect(registry).not.toBeNull();

  it("reports explicit coverage per requested family", () => {
    const coverage = coverageForFamilies(registry as NonNullable<typeof registry>, FAMILIES);
    expect(coverage).toHaveLength(3);
    const undeclared = coverage.filter((entry) => entry.status === "undeclared");
    expect(undeclared.map((entry) => entry.family)).toEqual(["audit_trail"]);
    const declared = coverage.find((entry) => entry.family === "identity_record");
    expect(declared).toEqual({
      family: "identity_record",
      status: "declared",
      rtoMinutes: 240,
      rpoMinutes: 60,
    });
    expect(undeclared[0].rtoMinutes).toBeNull();
    expect(undeclared[0].rpoMinutes).toBeNull();
  });

  it("lists undeclared families exactly", () => {
    expect(undeclaredFamilies(registry as NonNullable<typeof registry>, FAMILIES)).toEqual(["audit_trail"]);
  });

  it("fails coverageGaps closed when a required family is undeclared", () => {
    const gaps = coverageGaps(registry as NonNullable<typeof registry>, FAMILIES);
    expect(gaps.ok).toBe(false);
    expect(gaps.undeclared).toEqual(["audit_trail"]);
    expect(gaps.detail).toContain("fail-closed");
  });

  it("passes coverageGaps only when every requested family is declared", () => {
    const gaps = coverageGaps(registry as NonNullable<typeof registry>, ["event_ledger", "identity_record"]);
    expect(gaps.ok).toBe(true);
    expect(gaps.undeclared).toEqual([]);
    expect(gaps.detail).toBeNull();
  });
});

describe("envelope defaults", () => {
  it("uses the declared envelope when present", () => {
    const parsed = parseRecoveryTargets(VALID_REGISTRY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(effectiveEnvelope(parsed.registry)).toEqual({ maxRtoMinutes: 240, maxRpoMinutes: 60 });
    }
  });

  it("falls back to the global ceilings when no envelope is declared — a bounds default, not a commitment", () => {
    const parsed = parseRecoveryTargets({ declarations: [declaration("event_ledger")] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(effectiveEnvelope(parsed.registry)).toEqual({
        maxRtoMinutes: RTO_CEILING_MINUTES,
        maxRpoMinutes: RPO_CEILING_MINUTES,
      });
    }
  });
});

describe("module hygiene", () => {
  it("carries ceilings that are positive, bounded, and ordered", () => {
    expect(RTO_CEILING_MINUTES).toBeGreaterThan(0);
    expect(RPO_CEILING_MINUTES).toBeGreaterThan(0);
    expect(Number.isInteger(RTO_CEILING_MINUTES)).toBe(true);
    expect(Number.isInteger(RPO_CEILING_MINUTES)).toBe(true);
  });

  it("exposes the registry schema for downstream consumers (drill rehearsal)", () => {
    expect(typeof recoveryTargetRegistrySchema.safeParse).toBe("function");
    expect(recoveryTargetRegistrySchema.safeParse({ declarations: [] }).success).toBe(true);
  });
});