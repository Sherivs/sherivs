/**
 * CoreGrid — H3-071 phase-51 reality-os-kernel contract tests (mission G-071).
 * Zod validation of the kernel COMPOSITION surface: declarations composed of
 * universal kernel objects, relationships and events, composed READ-ONLY with
 * the kernel substrate's fail-closed draft builders; single tenant scope; no
 * anonymous composition; no fabricated identity (endpoint-less relationship
 * drafts); explicit causation roots; object-type allowlist gating (empty
 * allowlist rejects everything); all-or-nothing composition; governed entry
 * resolution; and the composition invariant report.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  COMPOSITION_BOUNDARY_STATEMENT,
  COMPOSITION_INVARIANT_IDS,
  COMPOSITION_MEMBER_KINDS,
  MAX_COMPOSITION_MEMBERS,
  REALITY_OS_KERNEL_CONTRACT_SCHEMA_VERSION,
  composeFromUntrusted,
  composeKernelUnit,
  evaluateCompositionInvariants,
  parseCompositionDeclaration,
  resolveComposedEntry,
  type ComposedKernelUnit,
  type CompositionDeclaration,
} from "../../frontend/src/lib/reality-os-kernel/contracts";

const NOW = "2026-10-03T00:00:00.000Z";
const TENANT = "tenant_alpha";
const OTHER_TENANT = "tenant_omega";

/** The composition-level allowlist used in happy-path tests. */
const ALLOWLIST = ["composition_unit", "core.entity", "core.relationship", "core.event"];

function envelope(objectType: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objectType,
    schemaVersion: "1.0",
    status: "draft",
    createdBy: "agent:h3-071",
    updatedBy: "agent:h3-071",
    provenance: { source: "contract:h3-071", originTenantId: TENANT },
    policyContext: {},
    traceId: "trace:1",
    correlationId: "corr:1",
    declaredOrigin: `origin:${objectType}`,
    ...overrides,
  };
}

function objectMember(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "object",
    key,
    draft: { entityType: "process" },
    envelope: envelope("core.entity"),
    ...overrides,
  };
}

function relationshipMember(
  key: string,
  sourceKey: string,
  targetKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "relationship",
    key,
    sourceKey,
    targetKey,
    draft: { relationType: "depends_on" },
    envelope: envelope("core.relationship"),
    ...overrides,
  };
}

function eventMember(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "event",
    key,
    draft: { eventType: "composition.recorded", aggregateType: "composition", aggregateId: "composition:1" },
    envelope: envelope("core.event"),
    ...overrides,
  };
}

function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    compositionId: "composition:1",
    tenantId: TENANT,
    entryKey: "obj:root",
    envelope: envelope("composition_unit"),
    members: [
      objectMember("obj:root", { draft: { entityType: "process", classification: "INTERNAL" } }),
      objectMember("obj:proxy", { draft: { entityType: "resource" } }),
      relationshipMember("rel:1", "obj:root", "obj:proxy"),
      eventMember("evt:1"),
    ],
    ...overrides,
  };
}

function composedUnit(): ComposedKernelUnit {
  const parsed = parseCompositionDeclaration(declaration());
  if (!parsed.ok) throw new Error(`fixture declaration must parse: ${JSON.stringify(parsed.issues)}`);
  const composed = composeKernelUnit(parsed.value, NOW, ALLOWLIST);
  if (!composed.ok) throw new Error(`fixture composition must compose: ${JSON.stringify(composed.issues)}`);
  return composed.value;
}

describe("H3-071 reality-os-kernel contracts — module surface", () => {
  it("is versioned, bounded and carries the composition boundary", () => {
    expect(REALITY_OS_KERNEL_CONTRACT_SCHEMA_VERSION).toBe("1.0");
    expect(MAX_COMPOSITION_MEMBERS).toBe(256);
    expect(COMPOSITION_MEMBER_KINDS).toEqual(["object", "relationship", "event"]);
    expect(COMPOSITION_INVARIANT_IDS).toEqual([
      "composition_stamped",
      "single_tenant_scope",
      "no_anonymous_members",
      "explicit_causation_root",
      "relationship_endpoints_resolved",
      "entry_resolvable",
      "bounded_unit",
    ]);
    expect(COMPOSITION_BOUNDARY_STATEMENT).toContain("composition is not authority");
  });
});

describe("H3-071 parseCompositionDeclaration", () => {
  it("parses a valid declaration with all three member kinds", () => {
    const parsed = parseCompositionDeclaration(declaration());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const declarationValue: CompositionDeclaration = parsed.value;
    expect(declarationValue.compositionId).toBe("composition:1");
    expect(declarationValue.tenantId).toBe(TENANT);
    expect(declarationValue.entryKey).toBe("obj:root");
    expect(declarationValue.members.map((member) => member.kind)).toEqual([
      "object",
      "object",
      "relationship",
      "event",
    ]);
    expect(declarationValue.envelope.objectType).toBe("composition_unit");
  });

  it("rejects invalid shapes: missing envelope, empty members, oversized member array, unknown keys", () => {
    expect(parseCompositionDeclaration(null).ok).toBe(false);
    expect(parseCompositionDeclaration({}).ok).toBe(false);

    const noEnvelope = declaration({ envelope: undefined });
    const parsedNoEnvelope = parseCompositionDeclaration(noEnvelope);
    expect(parsedNoEnvelope.ok).toBe(false);
    if (!parsedNoEnvelope.ok) expect(parsedNoEnvelope.reason).toBe("invalid_shape");

    const emptyMembers = declaration({ members: [] });
    const parsedEmpty = parseCompositionDeclaration(emptyMembers);
    expect(parsedEmpty.ok).toBe(false);
    if (!parsedEmpty.ok) expect(parsedEmpty.reason).toBe("invalid_shape");

    const oversized = declaration({
      members: Array.from({ length: MAX_COMPOSITION_MEMBERS + 1 }, (_, index) =>
        objectMember(`obj:${index}`),
      ),
    });
    const parsedOversized = parseCompositionDeclaration(oversized);
    expect(parsedOversized.ok).toBe(false);
    if (!parsedOversized.ok) expect(parsedOversized.reason).toBe("invalid_shape");

    const strayTenant = declaration({
      members: [
        objectMember("obj:root", { draft: { entityType: "process", tenantId: OTHER_TENANT } }),
      ],
      entryKey: "obj:root",
    });
    const parsedStray = parseCompositionDeclaration(strayTenant);
    expect(parsedStray.ok).toBe(false);
    if (!parsedStray.ok) {
      expect(parsedStray.reason).toBe("invalid_shape");
      expect(JSON.stringify(parsedStray.issues)).toContain("tenantId");
    }
  });

  it("rejects duplicate member keys", () => {
    const duplicated = declaration({
      members: [objectMember("obj:root"), objectMember("obj:root")],
    });
    const parsed = parseCompositionDeclaration(duplicated);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("duplicate_member_key");
      expect(parsed.issues[0].path).toContain("obj:root");
    }
  });

  it("rejects relationship endpoints that dangle, bind to non-objects, or self-reference", () => {
    const dangling = declaration({
      members: [
        objectMember("obj:root"),
        relationshipMember("rel:1", "obj:root", "obj:missing"),
      ],
    });
    const parsedDangling = parseCompositionDeclaration(dangling);
    expect(parsedDangling.ok).toBe(false);
    if (!parsedDangling.ok) expect(parsedDangling.reason).toBe("unresolved_reference");

    const bindsEvent = declaration({
      members: [
        objectMember("obj:root"),
        eventMember("evt:1"),
        relationshipMember("rel:1", "obj:root", "evt:1"),
      ],
    });
    const parsedBindsEvent = parseCompositionDeclaration(bindsEvent);
    expect(parsedBindsEvent.ok).toBe(false);
    if (!parsedBindsEvent.ok) expect(parsedBindsEvent.reason).toBe("unresolved_reference");

    const selfBound = declaration({
      members: [objectMember("obj:root"), relationshipMember("rel:1", "obj:root", "obj:root")],
    });
    const parsedSelf = parseCompositionDeclaration(selfBound);
    expect(parsedSelf.ok).toBe(false);
    if (!parsedSelf.ok) {
      expect(parsedSelf.reason).toBe("unresolved_reference");
      expect(JSON.stringify(parsedSelf.issues)).toContain("distinct endpoints");
    }
  });

  it("rejects entry keys that do not resolve to an object member", () => {
    const eventEntry = declaration({
      members: [objectMember("obj:root"), eventMember("evt:1")],
      entryKey: "evt:1",
    });
    const parsed = parseCompositionDeclaration(eventEntry);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("unresolvable_entry");
      expect(JSON.stringify(parsed.issues)).toContain("never a relationship or event");
    }
    const missingEntry = declaration({ entryKey: "obj:nowhere" });
    const parsedMissing = parseCompositionDeclaration(missingEntry);
    expect(parsedMissing.ok).toBe(false);
    if (!parsedMissing.ok) expect(parsedMissing.reason).toBe("unresolvable_entry");
  });

  it("rejects cross-tenant provenance on the composition or a member envelope", () => {
    const compositionCross = declaration({
      envelope: envelope("composition_unit", {
        provenance: { source: "contract:h3-071", originTenantId: OTHER_TENANT },
      }),
    });
    const parsedComposition = parseCompositionDeclaration(compositionCross);
    expect(parsedComposition.ok).toBe(false);
    if (!parsedComposition.ok) expect(parsedComposition.reason).toBe("cross_tenant_scope");

    const memberCross = declaration({
      members: [
        objectMember("obj:root", {
          envelope: envelope("core.entity", {
            provenance: { source: "contract:h3-071", originTenantId: OTHER_TENANT },
          }),
        }),
      ],
    });
    const parsedMember = parseCompositionDeclaration(memberCross);
    expect(parsedMember.ok).toBe(false);
    if (!parsedMember.ok) {
      expect(parsedMember.reason).toBe("cross_tenant_scope");
      expect(parsedMember.issues[0].path).toContain("members[obj:root].envelope");
    }
  });
});

describe("H3-071 composeKernelUnit", () => {
  it("composes a unit of insert-ready, envelope-stamped kernel drafts", () => {
    const unit = composedUnit();
    expect(unit.compositionId).toBe("composition:1");
    expect(unit.tenantId).toBe(TENANT);
    expect(unit.compositionEnvelope.object_type).toBe("composition_unit");
    expect(unit.objects).toHaveLength(2);
    expect(unit.relationships).toHaveLength(1);
    expect(unit.events).toHaveLength(1);

    const root = unit.objects[0];
    expect(root.key).toBe("obj:root");
    expect(root.draft.entity_type).toBe("process");
    expect(root.draft.classification).toBe("INTERNAL");
    expect(root.draft.recorded_at).toBe(NOW);
    expect(root.draft.tenant_id).toBe(TENANT);
    expect(root.draft.object_type).toBe("core.entity");
    expect(root.draft.schema_version).toBe("1.0");
    expect(root.draft.trace_id).toBe("trace:1");
    expect(root.draft.provenance.source).toBe("contract:h3-071");

    const event = unit.events[0];
    expect(event.draft.event_type).toBe("composition.recorded");
    expect(event.draft.state).toBe("pending");
    expect(event.draft.tenant_id).toBe(TENANT);
    expect(event.draft.object_type).toBe("core.event");
    expect(event.draft.declared_origin).toBe("origin:core.event");
  });

  it("never fabricates relationship identity: composed relationship drafts omit the endpoint columns", () => {
    const unit = composedUnit();
    const relationship = unit.relationships[0];
    expect(relationship.key).toBe("rel:1");
    expect(relationship.sourceKey).toBe("obj:root");
    expect(relationship.targetKey).toBe("obj:proxy");
    expect(relationship.draft.relation_type).toBe("depends_on");
    expect("source_entity_id" in relationship.draft).toBe(false);
    expect("target_entity_id" in relationship.draft).toBe(false);
    expect(relationship.draft.object_type).toBe("core.relationship");
  });

  it("rejects every member type under an EMPTY allowlist (fail-closed bootstrap)", () => {
    const parsed = parseCompositionDeclaration(declaration());
    if (!parsed.ok) throw new Error("fixture must parse");
    const composed = composeKernelUnit(parsed.value, NOW, []);
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.reason).toBe("substrate_rejected");
      expect(JSON.stringify(composed.issues)).toContain("is not registered");
    }
  });

  it("rejects unregistered object types under an explicit allowlist", () => {
    const parsed = parseCompositionDeclaration(declaration());
    if (!parsed.ok) throw new Error("fixture must parse");
    const composed = composeKernelUnit(parsed.value, NOW, ["composition_unit", "core.entity"]);
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.reason).toBe("substrate_rejected");
      expect(JSON.stringify(composed.issues)).toContain("core.relationship");
    }
  });

  it("re-checks tenant scope at compose time for hand-built declarations (defense-in-depth)", () => {
    const handBuilt: CompositionDeclaration = {
      schemaVersion: "1.0",
      compositionId: "composition:1",
      tenantId: TENANT,
      entryKey: "obj:root",
      envelope: envelope("composition_unit") as CompositionDeclaration["envelope"],
      members: [
        {
          kind: "object",
          key: "obj:root",
          draft: { entityType: "process" },
          envelope: envelope("core.entity", {
            provenance: { source: "contract:h3-071", originTenantId: OTHER_TENANT },
          }) as CompositionDeclaration["members"][number]["envelope"],
        },
      ],
    };
    const composed = composeKernelUnit(handBuilt, NOW, ALLOWLIST);
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.reason).toBe("cross_tenant_scope");
      expect(JSON.stringify(composed.issues)).toContain("tenant_omega");
    }
  });

  it("maps substrate rejections to a typed failure and composes nothing", () => {
    const badConfidence = declaration({
      members: [objectMember("obj:root", { draft: { entityType: "process", confidence: 2 } })],
    });
    const parsed = parseCompositionDeclaration(badConfidence);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const composed = composeKernelUnit(parsed.value, NOW, ALLOWLIST);
    expect(composed.ok).toBe(false);
    if (!composed.ok) {
      expect(composed.reason).toBe("substrate_rejected");
      expect(JSON.stringify(composed.issues)).toContain("confidence");
    }
  });

  it("is all-or-nothing: a failing member leaves no partial unit", () => {
    const parsed = parseCompositionDeclaration(
      declaration({
        members: [
          objectMember("obj:root"),
          eventMember("evt:1", { draft: { eventType: "", aggregateType: "composition", aggregateId: "x" } }),
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const composed = composeKernelUnit(parsed.value, NOW, ALLOWLIST);
    expect(composed.ok).toBe(false);
    if (!composed.ok) expect(composed.issues.length).toBeGreaterThan(0);
  });
});

describe("H3-071 composeFromUntrusted", () => {
  it("composes straight from untrusted input", () => {
    const composed = composeFromUntrusted(declaration(), NOW, ALLOWLIST);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.value.objects).toHaveLength(2);
  });

  it("fails closed at the parse stage for untrusted input", () => {
    const composed = composeFromUntrusted({ compositionId: "composition:1" }, NOW, ALLOWLIST);
    expect(composed.ok).toBe(false);
    if (!composed.ok) expect(composed.reason).toBe("invalid_shape");
  });
});

describe("H3-071 resolveComposedEntry", () => {
  it("resolves the governed entry point to the declared object member", () => {
    const unit = composedUnit();
    const resolution = resolveComposedEntry(unit);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.entry.key).toBe("obj:root");
  });

  it("fails closed when the entry key does not resolve", () => {
    const unit = composedUnit();
    const broken = { ...unit, entryKey: "obj:nowhere" };
    const resolution = resolveComposedEntry(broken);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toContain("fail-closed");
  });
});

describe("H3-071 evaluateCompositionInvariants", () => {
  it("satisfies every invariant for a composed unit and reports all checks", () => {
    const report = evaluateCompositionInvariants(composedUnit());
    expect(report.satisfied).toBe(true);
    expect(report.compositionId).toBe("composition:1");
    expect(report.tenantId).toBe(TENANT);
    expect(report.checks.map((check) => check.id)).toEqual([...COMPOSITION_INVARIANT_IDS]);
    expect(report.checks.every((check) => check.satisfied)).toBe(true);
  });

  it("flags an off-tenant member draft (defense-in-depth over foreign units)", () => {
    const unit = composedUnit();
    const tampered: ComposedKernelUnit = {
      ...unit,
      objects: unit.objects.map((object) =>
        object.key === "obj:proxy"
          ? { ...object, draft: { ...object.draft, tenant_id: OTHER_TENANT } }
          : object,
      ),
    };
    const report = evaluateCompositionInvariants(tampered);
    expect(report.satisfied).toBe(false);
    const scope = report.checks.find((check) => check.id === "single_tenant_scope");
    expect(scope?.satisfied).toBe(false);
  });

  it("flags a cross-tenant provenance origin inside a member draft", () => {
    const unit = composedUnit();
    const tampered: ComposedKernelUnit = {
      ...unit,
      events: unit.events.map((event) =>
        event.key === "evt:1"
          ? {
              ...event,
              draft: {
                ...event.draft,
                provenance: { ...event.draft.provenance, originTenantId: OTHER_TENANT },
              },
            }
          : event,
      ),
    };
    const report = evaluateCompositionInvariants(tampered);
    expect(report.satisfied).toBe(false);
    const scope = report.checks.find((check) => check.id === "single_tenant_scope");
    expect(scope?.satisfied).toBe(false);
  });

  it("flags an anonymous member draft stripped of its envelope", () => {
    const unit = composedUnit();
    const first = unit.objects[0];
    const { object_type: _t, schema_version: _s, trace_id: _tr, correlation_id: _c, created_by: _cb, ...bare } =
      first.draft;
    const tampered: ComposedKernelUnit = {
      ...unit,
      objects: unit.objects.map((object) =>
        object.key === first.key ? { ...object, draft: bare as typeof object.draft } : object,
      ),
    };
    const report = evaluateCompositionInvariants(tampered);
    expect(report.satisfied).toBe(false);
    const anonymity = report.checks.find((check) => check.id === "no_anonymous_members");
    expect(anonymity?.satisfied).toBe(false);
  });

  it("flags a composition record without an explicit causation root", () => {
    const unit = composedUnit();
    const tampered: ComposedKernelUnit = {
      ...unit,
      compositionEnvelope: {
        ...unit.compositionEnvelope,
        causation_id: null,
        parent_event_id: null,
        declared_origin: null,
      },
    };
    const report = evaluateCompositionInvariants(tampered);
    expect(report.satisfied).toBe(false);
    const causation = report.checks.find((check) => check.id === "explicit_causation_root");
    expect(causation?.satisfied).toBe(false);
  });

  it("flags unresolved relationship endpoints and an unresolvable entry", () => {
    const unit = composedUnit();
    const dangling: ComposedKernelUnit = {
      ...unit,
      relationships: unit.relationships.map((relationship) =>
        relationship.key === "rel:1" ? { ...relationship, targetKey: "obj:missing" } : relationship,
      ),
    };
    const danglingReport = evaluateCompositionInvariants(dangling);
    expect(danglingReport.satisfied).toBe(false);
    expect(
      danglingReport.checks.find((check) => check.id === "relationship_endpoints_resolved")?.satisfied,
    ).toBe(false);

    const entryless: ComposedKernelUnit = { ...unit, entryKey: "obj:missing" };
    const entryReport = evaluateCompositionInvariants(entryless);
    expect(entryReport.satisfied).toBe(false);
    expect(entryReport.checks.find((check) => check.id === "entry_resolvable")?.satisfied).toBe(false);
  });
});
