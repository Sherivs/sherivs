/**
 * CoreGrid — H3-048 audit query-surface contract tests (Squad F, F-048).
 * Proves the audit READ contract is tenant-bound, time-bounded,
 * actor-scoped, structurally refuses unbounded queries and cross-tenant
 * filters, returns deep-frozen read-only views, and never binds a store
 * client (the DB layer stays behind RLS). Pure offline: no network, no
 * database, no secrets.
 */
import { describe, expect, it } from "vitest";
import type { AuditAction } from "../../frontend/src/lib/audit";
import {
  MAX_AUDIT_WINDOW_MS,
  MAX_FUTURE_SKEW_MS,
  MAX_PAGE_LIMIT,
  freezeAuditPage,
  parseAuditPage,
  parseAuditQueryEnvelope,
  type AuditQueryEnvelope,
  type AuditReadAdapter,
} from "../../frontend/src/lib/audit/query-surface.contract";

function envelope(overrides: Partial<AuditQueryEnvelope> = {}): AuditQueryEnvelope {
  return {
    tenantId: "tenant_a",
    actorRef: "actor_reviewer_1",
    purpose: "compliance review of recent mutations",
    timeWindow: {
      fromIso: "2026-09-26T00:00:00.000Z",
      toIso: "2026-10-02T00:00:00.000Z",
    },
    filters: {},
    pagination: { limit: 50 },
    ...overrides,
  };
}

describe("envelope parsing (fail-closed admission)", () => {
  it("accepts a valid bounded envelope", () => {
    const parsed = parseAuditQueryEnvelope(envelope());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.envelope.tenantId).toBe("tenant_a");
  });

  it("refuses garbage input without throwing", () => {
    expect(parseAuditQueryEnvelope(null).ok).toBe(false);
    expect(parseAuditQueryEnvelope(undefined).ok).toBe(false);
    expect(parseAuditQueryEnvelope(42).ok).toBe(false);
    expect(parseAuditQueryEnvelope([envelope()]).ok).toBe(false);
  });

  it("is tenant-bound: missing or malformed tenant is refused", () => {
    expect(parseAuditQueryEnvelope(envelope({ tenantId: "" })).ok).toBe(false);
    expect(parseAuditQueryEnvelope({ ...envelope(), tenantId: undefined }).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ tenantId: "TENANT_A" })).ok).toBe(false);
  });

  it("structurally refuses cross-tenant filters — no tenant-listing key parses", () => {
    const listing = envelope() as AuditQueryEnvelope & { tenantIds?: string[] };
    expect(parseAuditQueryEnvelope({ ...listing, tenantIds: ["tenant_b"] }).ok).toBe(false);
    const wildcard = envelope() as AuditQueryEnvelope & { tenantId?: string };
    expect(parseAuditQueryEnvelope({ ...wildcard, tenantId: "*" }).ok).toBe(false);
  });

  it("structurally refuses a tenant filter inside the narrowing-only filter object", () => {
    const polluted = envelope({
      filters: { tenantId: "tenant_b" } as unknown as AuditQueryEnvelope["filters"],
    });
    expect(parseAuditQueryEnvelope(polluted).ok).toBe(false);
  });

  it("is time-bounded: a missing window never parses", () => {
    const missing = envelope();
    const broken = { ...missing, timeWindow: undefined };
    expect(parseAuditQueryEnvelope(broken).ok).toBe(false);
  });

  it("is time-bounded: unordered or inverted windows are refused", () => {
    expect(
      parseAuditQueryEnvelope(
        envelope({
          timeWindow: { fromIso: "2026-10-02T00:00:00.000Z", toIso: "2026-09-26T00:00:00.000Z" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseAuditQueryEnvelope(
        envelope({
          timeWindow: { fromIso: "2026-10-02T00:00:00.000Z", toIso: "2026-10-02T00:00:00.000Z" },
        }),
      ).ok,
    ).toBe(false);
  });

  it("is time-bounded: a window wider than the hard ceiling is refused", () => {
    const wide = envelope({
      timeWindow: {
        fromIso: "2026-09-01T00:00:00.000Z",
        toIso: "2026-10-02T00:00:00.000Z",
      },
    });
    const parsed = parseAuditQueryEnvelope(wide);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join(" ")).toContain(MAX_AUDIT_WINDOW_MS.toString());
  });

  it("refuses a window ending too far in the future when anchored to a now", () => {
    const future = envelope({
      timeWindow: {
        fromIso: "2026-10-03T00:00:00.000Z",
        toIso: "2026-10-04T00:00:00.000Z",
      },
    });
    const nowMs = Date.parse("2026-10-03T00:00:00.000Z");
    expect(parseAuditQueryEnvelope(future, { nowMs }).ok).toBe(false);
    const withinSkew = envelope({
      timeWindow: {
        fromIso: "2026-10-02T23:59:59.000Z",
        toIso: "2026-10-03T00:00:30.000Z",
      },
    });
    expect(parseAuditQueryEnvelope(withinSkew, { nowMs }).ok).toBe(true);
    expect(MAX_FUTURE_SKEW_MS).toBeGreaterThan(0);
  });

  it("is actor-scoped: a missing or blank actor never parses — all-actors is not representable", () => {
    expect(parseAuditQueryEnvelope({ ...envelope(), actorRef: undefined }).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ actorRef: "" })).ok).toBe(false);
    const allActors = envelope() as AuditQueryEnvelope & { actorRefs?: string[] };
    expect(parseAuditQueryEnvelope({ ...allActors, actorRefs: ["a", "b"] }).ok).toBe(false);
  });

  it("structurally refuses unbounded pagination — a limit is mandatory and capped", () => {
    const noPage = envelope();
    expect(parseAuditQueryEnvelope({ ...noPage, pagination: undefined }).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ pagination: { limit: 0 } })).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ pagination: { limit: -5 } })).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ pagination: { limit: MAX_PAGE_LIMIT + 1 } })).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ pagination: { limit: MAX_PAGE_LIMIT } })).ok).toBe(true);
  });

  it("enforces purpose limitation — a query without a purpose is refused", () => {
    expect(parseAuditQueryEnvelope({ ...envelope(), purpose: undefined }).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ purpose: "short" })).ok).toBe(false);
    expect(parseAuditQueryEnvelope(envelope({ purpose: "   " })).ok).toBe(false);
  });

  it("accepts narrowing-only filters and composes the shared audit action vocabulary", () => {
    const parsed = parseAuditQueryEnvelope(
      envelope({ filters: { action: "update", tableName: "core_record", recordId: "rec_1" } }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const composed: AuditAction | undefined = parsed.envelope.filters.action;
      expect(composed).toBe("update");
    }
  });
});

describe("page parsing (read-only views, tenant coherence)", () => {
  const env = envelope();

  it("parses a valid page and deep-freezes every layer", () => {
    const parsed = parseAuditPage(
      {
        records: [
          {
            tenantId: "tenant_a",
            actorRef: "actor_reviewer_1",
            action: "create",
            tableName: "core_record",
            recordId: "rec_1",
            occurredAt: "2026-09-27T12:00:00.000Z",
          },
        ],
        nextCursor: "cur_002",
        hasMore: true,
      },
      env,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.isFrozen(parsed.page)).toBe(true);
      expect(Object.isFrozen(parsed.page.records)).toBe(true);
      expect(Object.isFrozen(parsed.page.records[0])).toBe(true);
      const attempt = parsed.page.records[0];
      expect(() => {
        (attempt as { tenantId?: string }).tenantId = "tenant_b";
      }).toThrow(TypeError);
      expect(attempt.tenantId).toBe("tenant_a");
    }
  });

  it("refuses a page containing any record outside the envelope's tenant", () => {
    const parsed = parseAuditPage(
      {
        records: [
          {
            tenantId: "tenant_a",
            actorRef: "actor_reviewer_1",
            action: "create",
            tableName: "core_record",
            recordId: "rec_1",
            occurredAt: "2026-09-27T12:00:00.000Z",
          },
          {
            tenantId: "tenant_b",
            actorRef: "actor_reviewer_1",
            action: "create",
            tableName: "core_record",
            recordId: "rec_2",
            occurredAt: "2026-09-27T12:01:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
      env,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe("cross_tenant_record_refused");
      expect(parsed.issues[0]).toContain("outside tenant tenant_a");
    }
  });

  it("refuses malformed pages (unknown keys, wrong shapes) without throwing", () => {
    expect(parseAuditPage(null, env).ok).toBe(false);
    expect(parseAuditPage({}, env).ok).toBe(false);
    expect(
      parseAuditPage({ records: [], nextCursor: null, hasMore: false, recordsExtra: true }, env).ok,
    ).toBe(false);
  });

  it("freezeAuditPage accepts and re-freezes an already-frozen page", () => {
    const first = freezeAuditPage({ records: [], nextCursor: null, hasMore: false });
    expect(Object.isFrozen(first)).toBe(true);
    const refrozen = freezeAuditPage(first);
    expect(Object.isFrozen(refrozen)).toBe(true);
    expect(refrozen.records).toHaveLength(0);
  });
});

describe("store adapter contract (no client binding, RLS stays the boundary)", () => {
  it("accepts any typed adapter and round-trips a bounded read", async () => {
    const envParsed = parseAuditQueryEnvelope(envelope({ pagination: { limit: 10 } }));
    expect(envParsed.ok).toBe(true);
    if (!envParsed.ok) return;

    const adapter: AuditReadAdapter = {
      name: "in-memory-rls-backed-store",
      readPage: async (query: AuditQueryEnvelope) => ({
        records:
          query.tenantId === "tenant_a"
            ? [
                {
                  tenantId: query.tenantId,
                  actorRef: query.actorRef,
                  action: "delete",
                  tableName: "core_record",
                  recordId: null,
                  occurredAt: "2026-09-28T08:00:00.000Z",
                },
              ]
            : [],
        nextCursor: null,
        hasMore: false,
      }),
    };

    const page = await adapter.readPage(envParsed.envelope);
    const pageParsed = parseAuditPage(page, envParsed.envelope);
    expect(pageParsed.ok).toBe(true);
    if (pageParsed.ok) {
      expect(pageParsed.page.records).toHaveLength(1);
      expect(pageParsed.page.records[0].recordId).toBeNull();
    }
  });

  it("a misbehaving adapter leaking another tenant is caught by the contract", async () => {
    const envParsed = parseAuditQueryEnvelope(envelope());
    expect(envParsed.ok).toBe(true);
    if (!envParsed.ok) return;

    const leaky: AuditReadAdapter = {
      name: "leaky-store",
      readPage: async () => ({
        records: [
          {
            tenantId: "tenant_b",
            actorRef: "actor_reviewer_1",
            action: "create",
            tableName: "core_record",
            recordId: "rec_9",
            occurredAt: "2026-09-28T08:00:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    };

    const page = await leaky.readPage(envParsed.envelope);
    const pageParsed = parseAuditPage(page, envParsed.envelope);
    expect(pageParsed.ok).toBe(false);
    if (!pageParsed.ok) expect(pageParsed.code).toBe("cross_tenant_record_refused");
  });
});