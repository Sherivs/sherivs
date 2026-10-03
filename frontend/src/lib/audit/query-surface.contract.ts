/**
 * CoreGrid — audit READ query-surface contract (H3 wave Squad F, mission
 * F-048).
 *
 * WHAT: the typed envelope that every audit READ request must satisfy before
 * any audit store is consulted. This module owns the *query contract* only:
 * it validates and binds the request shape, and it validates and freezes the
 * returned page shape. It deliberately does NOT own a database client, a
 * connection, or an executor — the DB layer stays behind PostgreSQL Row
 * Level Security (AGENTS §17, §28). A store adapter implements the
 * `AuditReadAdapter` interface declared here; this module never
 * instantiates one. The existing write-side helper (`../audit`, imported
 * type-only and read-only) stays the single place that writes audit rows.
 *
 * Laws of this module (fail-closed, AGENTS §16/§17/§26/§27):
 * - Tenant-bound: exactly one tenant reference per envelope. There is no
 *   representable way to ask for several tenants: the envelope schema is a
 *   strict object with a single `tenantId` field and no tenant-listing or
 *   tenant-wildcard field anywhere; unknown keys are parse failures.
 * - Time-bounded: the window is mandatory, ordered (`toIso` strictly after
 *   `fromIso`), and no wider than `MAX_AUDIT_WINDOW_MS`. An unbounded or
 *   open-ended window does not parse. When a "now" anchor is supplied, the
 *   window may not end more than `MAX_FUTURE_SKEW_MS` in the future.
 * - Actor-scoped: exactly one concrete actor reference per envelope. "All
 *   actors" is not a representable scope.
 * - Structurally unbounded-proof: pagination is mandatory with a positive
 *   limit at most `MAX_PAGE_LIMIT`; filters may only narrow (action, table
 *   ref, record ref) and may never broaden scope.
 * - Purpose-bound: a non-empty purpose string is required (purpose
 *   limitation, AGENTS §16).
 * - Read-only results: returned pages parse into deep-frozen read-only
 *   views; and every parsed record's tenant reference must equal the
 *   envelope's tenant reference or the page is refused (`cross_tenant_
 *   record_refused`). RLS remains the real boundary; this is defense in
 *   depth, never a replacement.
 *
 * Pure in-process contract: no I/O, no network, no persistence, no vendors,
 * no secrets, no `any`, no `z.any()`.
 */

import { z } from "zod";
import type { AuditAction } from "../audit";

/* ─────────────────────────────────────────────────────────────
 * Hard bounds (no unbounded audit reads)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on one audit read window, in ms (7 days). */
export const MAX_AUDIT_WINDOW_MS = 7 * 86_400_000;

/** Hard ceiling on one page of audit records. */
export const MAX_PAGE_LIMIT = 200;

/** Allowance for clock skew when anchoring a window against "now". */
export const MAX_FUTURE_SKEW_MS = 60_000;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;

function refSchema(label: string) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a lowercase identifier (letters, digits, _ . : -; starts with a letter; at most 128 characters)`,
    );
}

export const tenantIdSchema = refSchema("tenantId");
export type TenantId = z.infer<typeof tenantIdSchema>;

export const actorRefSchema = refSchema("actorRef");
export type ActorRef = z.infer<typeof actorRefSchema>;

/**
 * The audited action. Composed read-only with the write-side helper's
 * `AuditAction` type (`../audit`) so both sides of the audit trail share one
 * vocabulary without importing its runtime (which binds a store client).
 */
export const auditActionSchema: z.ZodType<AuditAction> = z
  .string()
  .min(1, "action must be a non-empty string")
  .max(64, "action must be at most 64 characters");

export type AuditQueryRefusalCode =
  | "unbounded_time_window"
  | "unbounded_actor_scope"
  | "unbounded_page"
  | "unbounded_future_window"
  | "cross_tenant_record_refused";

/**
 * Filters. Every field is optional and every field NARROWS the result set.
 * The strict object refuses any key that could broaden scope (there is no
 * tenant field here by construction).
 */
export const auditFiltersSchema = z.strictObject({
  action: auditActionSchema.optional(),
  tableName: refSchema("filters.tableName").optional(),
  recordId: refSchema("filters.recordId").optional(),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Mandatory bounded pagination. A query without a limit is unbounded. */
export const auditPaginationSchema = z.strictObject({
  limit: z
    .number()
    .int()
    .min(1, "pagination.limit must be at least 1 — zero-limit reads are refused")
    .max(MAX_PAGE_LIMIT, `pagination.limit exceeds the hard ceiling of ${MAX_PAGE_LIMIT}`),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,256}$/, "pagination.cursor must be an opaque cursor token")
    .optional(),
});
export type AuditPagination = z.infer<typeof auditPaginationSchema>;

/** Mandatory bounded, ordered time window. */
export const auditTimeWindowSchema = z
  .strictObject({
    fromIso: z.string().datetime(),
    toIso: z.string().datetime(),
  })
  .superRefine((window, ctx) => {
    const from = Date.parse(window.fromIso);
    const to = Date.parse(window.toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      ctx.addIssue({
        code: "custom",
        message: "timeWindow.toIso must be strictly after timeWindow.fromIso",
      });
      return;
    }
    if (to - from > MAX_AUDIT_WINDOW_MS) {
      ctx.addIssue({
        code: "custom",
        message: `timeWindow exceeds the hard ceiling of ${MAX_AUDIT_WINDOW_MS}ms — unbounded audit reads are refused`,
      });
    }
  });
export type AuditTimeWindow = z.infer<typeof auditTimeWindowSchema>;

/**
 * The query envelope: one tenant, one actor, one bounded window, one
 * bounded page, narrowing-only filters, one declared purpose.
 */
export const auditQueryEnvelopeSchema = z.strictObject({
  tenantId: tenantIdSchema,
  actorRef: actorRefSchema,
  purpose: z
    .string()
    .trim()
    .min(8, "purpose must be a non-blank string of at least 8 characters (purpose limitation)")
    .max(256),
  timeWindow: auditTimeWindowSchema,
  filters: auditFiltersSchema,
  pagination: auditPaginationSchema,
});
export type AuditQueryEnvelope = z.infer<typeof auditQueryEnvelopeSchema>;

/* ─────────────────────────────────────────────────────────────
 * Read-only result views
 * ────────────────────────────────────────────────────────────*/

/** One audit record as returned to the caller: a read-only view. */
export const auditRecordViewSchema = z.strictObject({
  tenantId: tenantIdSchema,
  actorRef: actorRefSchema,
  action: auditActionSchema,
  tableName: refSchema("record.tableName"),
  recordId: refSchema("record.recordId").nullable(),
  occurredAt: z.string().datetime(),
});
export type AuditRecordView = z.infer<typeof auditRecordViewSchema>;

/** One page of audit records: read-only views, bounded by the envelope. */
export const auditPageSchema = z.strictObject({
  records: z.array(auditRecordViewSchema),
  nextCursor: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/).nullable(),
  hasMore: z.boolean(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

/** Deeply frozen read-only view of a parsed audit page. */
export type FrozenAuditPage = Readonly<{
  records: readonly AuditRecordView[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

/** Shape accepted by the freeze helper: mutable or already-frozen pages. */
export type AuditPageLike = Readonly<{
  records: readonly AuditRecordView[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

/* ─────────────────────────────────────────────────────────────
 * Parse results (typed, never throwing on refusal)
 * ────────────────────────────────────────────────────────────*/

export type AuditQueryParseResult =
  | { ok: true; envelope: AuditQueryEnvelope }
  | { ok: false; issues: string[] };

export type AuditPageParseResult =
  | { ok: true; page: FrozenAuditPage }
  | { ok: false; code: AuditQueryRefusalCode; issues: string[] };

/* ─────────────────────────────────────────────────────────────
 * Envelope parsing (structural refusal of unbounded queries)
 * ────────────────────────────────────────────────────────────*/

/**
 * Validate an audit READ request envelope. Missing tenant, missing actor,
 * missing window, missing page limit, over-ceiling window or limit, and any
 * unknown key (including any tenant-listing or cross-tenant filter field)
 * are all parse failures. `options.nowMs` optionally anchors the future-
 * window check against an injected clock.
 */
export function parseAuditQueryEnvelope(
  input: unknown,
  options: { nowMs?: number } = {},
): AuditQueryParseResult {
  const parsed = auditQueryEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };
  }
  const envelope = parsed.data;
  const issues: string[] = [];
  if (options.nowMs !== undefined) {
    const to = Date.parse(envelope.timeWindow.toIso);
    if (Number.isFinite(to) && to - options.nowMs > MAX_FUTURE_SKEW_MS) {
      issues.push("timeWindow.toIso ends too far in the future");
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, envelope };
}

/* ─────────────────────────────────────────────────────────────
 * Page parsing (read-only views + tenant coherence)
 * ────────────────────────────────────────────────────────────*/

/**
 * Validate a page returned by an audit store adapter for a given envelope,
 * deep-freeze it, and refuse it if any record falls outside the envelope's
 * tenant. RLS is the primary boundary (AGENTS §17); this coherence check is
 * defense in depth and never a replacement.
 */
export function parseAuditPage(
  input: unknown,
  envelope: AuditQueryEnvelope,
): AuditPageParseResult {
  const parsed = auditPageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "unbounded_page", issues: parsed.error.issues.map((issue) => issue.message) };
  }
  const foreign = parsed.data.records.filter((record) => record.tenantId !== envelope.tenantId);
  if (foreign.length > 0) {
    return {
      ok: false,
      code: "cross_tenant_record_refused",
      issues: [
        `page contains ${String(foreign.length)} record(s) outside tenant ${envelope.tenantId} — cross-tenant results are refused`,
      ],
    };
  }
  return { ok: true, page: freezeAuditPage(parsed.data) };
}

/** Deep-freeze a parsed page so the result surface is read-only. */
export function freezeAuditPage(page: AuditPageLike): FrozenAuditPage {
  return Object.freeze({
    records: Object.freeze(page.records.map((record) => Object.freeze({ ...record }))),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Store adapter contract (the DB layer lives behind RLS)
 * ────────────────────────────────────────────────────────────*/

/**
 * The ONLY way an audit read reaches a store: a typed adapter implemented
 * by the DB layer behind RLS. This module declares the shape and never
 * constructs, imports, or binds a client. Implementations MUST resolve the
 * caller's authorization and rely on RLS for tenant isolation (AGENTS §17,
 * §26, §27); the contract's tenant-coherence check is defense in depth.
 */
export interface AuditReadAdapter {
  /** Human-readable adapter name for observability (no secrets). */
  readonly name: string;
  /** Execute one already-validated, bounded envelope; return one page. */
  readPage(envelope: AuditQueryEnvelope): Promise<AuditPage>;
}