/**
 * CoreGrid — Canonical CoreObject envelope conformance (V1CAP-002, MISSION-R-10).
 *
 * Proves, at unit level, that:
 *  1. the envelope contract is fail-closed — an anonymous persistent kernel
 *     object (missing any envelope field) is rejected;
 *  2. every kernel write path (entityDraft, relationshipDraft, observationDraft,
 *     eventDraft) stamps and enforces the envelope on the persistent row;
 *  3. the causation chain root is explicit (J-001/G-010);
 *  4. cross-tenant provenance is rejected;
 *  5. unknown object types are rejected when the type registry is supplied
 *     (MISSION-R-11 injects the registry through `knownObjectTypes` without any
 *     API change; omitting the parameter defers the gate until R-11 lands);
 *  6. the envelope migration and its rollback stay mechanically coherent with
 *     the TypeScript contract (KERNEL_ENVELOPE_COLUMNS).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENVELOPE_SCHEMA_VERSION,
  KERNEL_ENVELOPE_COLUMNS,
  KERNEL_OBJECT_STATUSES,
  entityDraft,
  envelopeColumns,
  eventDraft,
  isSchemaVersion,
  observationDraft,
  relationshipDraft,
  stampKernelDraft,
  validateKernelObjectEnvelope,
  validateKernelRowEnvelope,
  type KernelObjectEnvelopeInput,
} from "@/lib/kernel/reality";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000000_coregrid_v1_kernel_envelope.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000000_coregrid_v1_kernel_envelope.sql"),
  "utf8",
);
const NOW = "2026-10-02T00:00:00.000Z";

/**
 * Sample canonical registry slice. MISSION-R-11 owns the real registry; this
 * parameter shape is exactly what R-11 will pass — the envelope API does not
 * change when the registry module lands.
 */
const KNOWN_OBJECT_TYPES = [
  "core.entity",
  "core.relationship",
  "core.event",
  "core.observation",
] as const;

function baseEnvelope(overrides: Partial<KernelObjectEnvelopeInput> = {}): KernelObjectEnvelopeInput {
  return {
    objectType: "core.entity",
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: "active",
    createdBy: "identity:engineer-1",
    updatedBy: "identity:engineer-1",
    provenance: { source: "kernel:test", originTenantId: "tenant-1" },
    policyContext: { policy: "core.data.internal" },
    traceId: "trace-1",
    correlationId: "corr-1",
    declaredOrigin: "kernel:test:bootstrap",
    ...overrides,
  };
}

function omit<K extends keyof KernelObjectEnvelopeInput>(
  envelope: KernelObjectEnvelopeInput,
  key: K,
): KernelObjectEnvelopeInput {
  const clone: Partial<KernelObjectEnvelopeInput> = { ...envelope };
  delete clone[key];
  return clone as KernelObjectEnvelopeInput;
}

describe("kernel envelope contract — vocabulary", () => {
  it("exposes the neutral lifecycle vocabulary and schema version", () => {
    expect(KERNEL_OBJECT_STATUSES).toEqual([
      "draft",
      "active",
      "suspended",
      "archived",
      "deleted",
    ]);
    expect(ENVELOPE_SCHEMA_VERSION).toBe("1.0");
    expect(isSchemaVersion("1.0")).toBe(true);
    expect(isSchemaVersion("1")).toBe(false);
    expect(isSchemaVersion("1.0.0-rc.1")).toBe(false);
    expect(isSchemaVersion(1.0)).toBe(false);
  });

  it("lists exactly the envelope columns the migration must author", () => {
    expect(KERNEL_ENVELOPE_COLUMNS).toEqual([
      "object_type",
      "schema_version",
      "status",
      "created_by",
      "updated_by",
      "provenance",
      "policy_context",
      "trace_id",
      "correlation_id",
      "causation_id",
      "parent_event_id",
      "declared_origin",
    ]);
  });
});

describe("kernel envelope contract — fail-closed validation", () => {
  it("accepts and normalizes a complete envelope", () => {
    const envelope = validateKernelObjectEnvelope(
      baseEnvelope({ objectType: "  core.entity  ", traceId: "  trace-1  " }),
      KNOWN_OBJECT_TYPES,
    );
    expect(envelope.object_type).toBe("core.entity");
    expect(envelope.trace_id).toBe("trace-1");
    expect(envelope.provenance.generatedByAi).toBe(false);
    expect(envelope.causation_id).toBeNull();
    expect(envelope.parent_event_id).toBeNull();
    expect(envelope.declared_origin).toBe("kernel:test:bootstrap");
  });

  it("rejects an anonymous object missing ANY required envelope field", () => {
    for (const key of [
      "objectType",
      "schemaVersion",
      "status",
      "createdBy",
      "updatedBy",
      "provenance",
      "policyContext",
      "traceId",
      "correlationId",
    ] as const) {
      expect(() => validateKernelObjectEnvelope(omit(baseEnvelope(), key), KNOWN_OBJECT_TYPES))
        .toThrow(new RegExp(`envelope ${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`));
    }
    // Malformed provenance (missing source) is rejected too.
    expect(() =>
      validateKernelObjectEnvelope(baseEnvelope({ provenance: { source: "" } })),
    ).toThrow(/provenance\.source/);
  });

  it("rejects malformed field values the database CHECKs would reject", () => {
    expect(() =>
      validateKernelObjectEnvelope(baseEnvelope({ schemaVersion: "one.two" })),
    ).toThrow(/schema_version/);
    expect(() =>
      validateKernelObjectEnvelope(baseEnvelope({ status: "deleted-but-keep" as never })),
    ).toThrow(/status/);
    expect(() =>
      validateKernelObjectEnvelope(baseEnvelope({ policyContext: [] as never })),
    ).toThrow(/policy_context/);
    expect(() =>
      validateKernelObjectEnvelope(baseEnvelope({ objectType: "x".repeat(129) })),
    ).toThrow(/object_type/);
  });

  it("rejects a broken causation chain — the chain root must be explicit", () => {
    const unrooted = baseEnvelope({
      causationId: null,
      parentEventId: null,
      declaredOrigin: null,
    });
    expect(() => validateKernelObjectEnvelope(unrooted)).toThrow(/causation chain root/);
    // Any one root form satisfies the law.
    expect(() =>
      validateKernelObjectEnvelope({ ...unrooted, causationId: "event-1" }),
    ).not.toThrow();
    expect(() =>
      validateKernelObjectEnvelope({ ...unrooted, parentEventId: "event-1" }),
    ).not.toThrow();
    expect(() =>
      validateKernelObjectEnvelope({ ...unrooted, declaredOrigin: "kernel:bootstrap" }),
    ).not.toThrow();
  });

  it("rejects unknown object types when the registry is supplied, defers when not", () => {
    const unregistered = baseEnvelope({ objectType: "scholar.ghost" });
    expect(() => validateKernelObjectEnvelope(unregistered, KNOWN_OBJECT_TYPES)).toThrow(
      /not registered/,
    );
    // Registry bootstrap is fail-closed: an EMPTY registry rejects everything.
    expect(() => validateKernelObjectEnvelope(baseEnvelope(), [])).toThrow(/not registered/);
    // Deferral posture (pre-R-11): the gate is inert until the registry lands.
    expect(() => validateKernelObjectEnvelope(unregistered)).not.toThrow();
  });
});

describe("kernel envelope — every kernel write path stamps the envelope", () => {
  it("stamps entityDraft with the full envelope columns", () => {
    const draft = entityDraft(
      {
        entityType: "person",
        tenantId: "tenant-1",
        envelope: baseEnvelope(),
      },
      NOW,
    );
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(draft).toHaveProperty(column);
    }
    const row: Record<string, unknown> = { id: "entity-1", ...draft };
    expect(() => validateKernelRowEnvelope(row, KNOWN_OBJECT_TYPES)).not.toThrow();
  });

  it("stamps relationshipDraft with the full envelope columns", () => {
    const draft = relationshipDraft(
      {
        sourceEntityId: "entity-a",
        targetEntityId: "entity-b",
        relationType: "related-to",
        tenantId: "tenant-1",
        envelope: baseEnvelope({ objectType: "core.relationship" }),
      },
      NOW,
    );
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(draft).toHaveProperty(column);
    }
    const row: Record<string, unknown> = { id: "rel-1", ...draft };
    expect(() => validateKernelRowEnvelope(row, KNOWN_OBJECT_TYPES)).not.toThrow();
  });

  it("stamps observationDraft with the full envelope columns", () => {
    const draft = observationDraft(
      {
        subjectEntityId: "entity-1",
        kind: "observed",
        tenantId: "tenant-1",
        envelope: baseEnvelope({ objectType: "core.observation" }),
      },
      NOW,
    );
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(draft).toHaveProperty(column);
    }
    const row: Record<string, unknown> = { id: "obs-1", ...draft };
    expect(() => validateKernelRowEnvelope(row, KNOWN_OBJECT_TYPES)).not.toThrow();
  });

  it("stamps eventDraft with the full envelope columns", () => {
    const draft = eventDraft(
      {
        eventType: "created",
        aggregateType: "entity",
        aggregateId: "entity-1",
        tenantId: "tenant-1",
        envelope: baseEnvelope({ objectType: "core.event", causationId: "cause-1" }),
      },
      NOW,
    );
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(draft).toHaveProperty(column);
    }
    const stampedRow: Record<string, unknown> = { id: "event-1", ...draft };
    expect(stampedRow.causation_id).toBe("cause-1");
    expect(() => validateKernelRowEnvelope(stampedRow, KNOWN_OBJECT_TYPES)).not.toThrow();
  });

  it("rejects a stamped write whose draft has no tenant scope", () => {
    expect(() =>
      entityDraft({ entityType: "person", envelope: baseEnvelope() }, NOW),
    ).toThrow(/requires a tenant_id/);
    expect(() =>
      stampKernelDraft({ tenant_id: null }, baseEnvelope(), KNOWN_OBJECT_TYPES),
    ).toThrow(/requires a tenant_id/);
  });

  it("rejects a stamped write whose envelope violates any envelope law", () => {
    expect(() =>
      entityDraft(
        { entityType: "person", tenantId: "tenant-1", envelope: omit(baseEnvelope(), "traceId") },
        NOW,
      ),
    ).toThrow(/trace_id/);
    expect(() =>
      eventDraft(
        {
          eventType: "created",
          aggregateType: "entity",
          aggregateId: "1",
          tenantId: "tenant-1",
          envelope: baseEnvelope({ objectType: "core.event", causationId: null, declaredOrigin: null, parentEventId: null }),
        },
        NOW,
      ),
    ).toThrow(/causation chain root/);
    expect(() =>
      relationshipDraft(
        {
          sourceEntityId: "entity-a",
          targetEntityId: "entity-b",
          relationType: "related-to",
          tenantId: "tenant-1",
          envelope: baseEnvelope({
            objectType: "core.relationship",
            causationId: null,
            parentEventId: null,
            declaredOrigin: null,
          }),
        },
        NOW,
      ),
    ).toThrow(/causation chain root/);
    expect(() =>
      observationDraft(
        {
          subjectEntityId: "entity-1",
          kind: "observed",
          tenantId: "tenant-1",
          envelope: omit(baseEnvelope({ objectType: "core.observation" }), "policyContext"),
        },
        NOW,
      ),
    ).toThrow(/policy_context/);
  });
});

describe("kernel envelope — tenant boundary", () => {
  it("rejects cross-tenant provenance on stamping", () => {
    expect(() =>
      stampKernelDraft(
        { tenant_id: "tenant-1" },
        baseEnvelope({ provenance: { source: "kernel:test", originTenantId: "tenant-2" } }),
        KNOWN_OBJECT_TYPES,
      ),
    ).toThrow(/cross-tenant/);
  });

  it("accepts provenance whose declared origin tenant matches the object tenant", () => {
    expect(() =>
      stampKernelDraft({ tenant_id: "tenant-1" }, baseEnvelope(), KNOWN_OBJECT_TYPES),
    ).not.toThrow();
  });

  it("rejects cross-tenant provenance on a persisted row", () => {
    const row: Record<string, unknown> = {
      id: "entity-1",
      tenant_id: "tenant-1",
      ...envelopeColumns(baseEnvelope({ provenance: { source: "s", originTenantId: "tenant-9" } })),
    };
    expect(() => validateKernelRowEnvelope(row)).toThrow(/cross-tenant/);
  });
});

describe("kernel envelope — persistent-row conformance gate (no anonymous object)", () => {
  it("rejects rows missing envelope fields", () => {
    const complete: Record<string, unknown> = {
      id: "entity-1",
      tenant_id: "tenant-1",
      ...envelopeColumns(baseEnvelope()),
    };
    expect(() => validateKernelRowEnvelope(complete)).not.toThrow();
    for (const key of ["id", "tenant_id", "object_type", "schema_version", "status",
      "created_by", "updated_by", "provenance", "policy_context", "trace_id", "correlation_id"]) {
      const anonymous = { ...complete };
      delete anonymous[key];
      expect(() => validateKernelRowEnvelope(anonymous)).toThrow();
    }
  });

  it("rejects a row whose causation chain is broken", () => {
    const row: Record<string, unknown> = {
      id: "entity-1",
      tenant_id: "tenant-1",
      ...envelopeColumns(baseEnvelope()),
      causation_id: null,
      parent_event_id: null,
      declared_origin: null,
    };
    expect(() => validateKernelRowEnvelope(row)).toThrow(/causation chain root/);
  });
});

describe("kernel envelope ↔ migration coherence", () => {
  it("is authored-not-applied in both migration and rollback", () => {
    expect(MIGRATION).toMatch(/AUTHORED, NOT APPLIED/);
    expect(ROLLBACK).toMatch(/AUTHORED, NOT APPLIED/);
  });

  it("authors every envelope column on every persistent kernel object table", () => {
    for (const table of ["cg_entity", "cg_relationship", "cg_event", "cg_observation"]) {
      for (const column of KERNEL_ENVELOPE_COLUMNS) {
        expect(MIGRATION).toMatch(
          new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS ${column}\\b`),
        );
        expect(ROLLBACK).toContain(`DROP COLUMN IF EXISTS ${column}`);
      }
    }
  });

  it("enforces envelope atomicity and the explicit causation root in SQL", () => {
    expect(MIGRATION).toContain("cg_entity_envelope_atomic");
    expect(MIGRATION).toContain("cg_event_envelope_causation_root");
    expect(MIGRATION).toContain("declared_origin IS NOT NULL");
  });

  it("leaves the deny-by-default security posture untouched", () => {
    expect(MIGRATION).not.toMatch(/GRANT /i);
    expect(MIGRATION).toMatch(/RLS stays enabled/);
  });
});
