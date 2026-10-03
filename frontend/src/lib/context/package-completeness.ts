/**
 * CoreGrid — context-package completeness checker (J-011 / H3 mission B-012).
 *
 * The governed assembler (`../context-assembly`) states four scope fields on
 * every assembled package: `memoryScope`, `dataScope`, `riskLevel` and
 * `traceId` (J-011: "every assembled package is fully scoped"). This module is
 * the Zod proof that a context package actually carries all four fields and
 * that each is well-formed — a package missing or malforming any of them is
 * incomplete and must fail closed.
 *
 * Invariants (Constitution §19, §21, §29; J-011):
 * - Completeness is proven per field: the verdict names exactly which fields
 *   are MISSING and which are present-but-MALFORMED, never a bare boolean.
 * - Every scope record is a closed shape (`domains`, `max_sensitivity`,
 *   `origin`); unknown keys cannot smuggle undeclared semantics into a scope.
 * - `risk_level` is the structured assessment `{ level, origin }`, mirroring
 *   the assembler's declared/derived vocabulary. This checker validates shape
 *   and completeness only; risk escalation semantics are owned by the
 *   assembler and are never re-derived here.
 * - `trace_id` must be a bounded, whitespace-free token so a package is always
 *   attributable and correlatable (§12 provenance, §29 observability).
 * - The checker is PURE: no I/O, no clock sampling, no authorization decisions.
 */

import { z } from "zod";
import type { ContextEnvelope } from "../context-assembly";

/* ─────────────────────────────────────────────────────────────
 * Field vocabulary
 * ────────────────────────────────────────────────────────────*/

/** The four fields whose presence proves a context package is fully scoped. */
export const COMPLETENESS_FIELDS = [
  "memory_scope",
  "data_scope",
  "risk_level",
  "trace_id",
] as const;

export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number];

export const SENSITIVITY_LEVELS = ["public", "internal", "restricted"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export const SCOPE_ORIGINS = ["declared", "derived"] as const;

/* ─────────────────────────────────────────────────────────────
 * Field schemas
 * ────────────────────────────────────────────────────────────*/

/** A scope domain: bounded, whitespace-free token. */
export const scopeDomainSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "domain must be a bounded token without whitespace");

/**
 * One scope statement of the package. `origin: "derived"` scopes may carry an
 * empty `domains` list (an explicitly empty derived scope is not a wildcard);
 * duplicates are rejected so the scope statement stays canonical.
 */
export const scopeRecordSchema = z
  .strictObject({
    domains: z
      .array(scopeDomainSchema)
      .max(64)
      .superRefine((domains, ctx) => {
        const seen = new Set<string>();
        for (const domain of domains) {
          if (seen.has(domain)) {
            ctx.addIssue({ code: "custom", message: `duplicate domain "${domain}"` });
          }
          seen.add(domain);
        }
      }),
    max_sensitivity: z.enum(SENSITIVITY_LEVELS),
    origin: z.enum(SCOPE_ORIGINS),
  });

/** Stated risk of the package: level plus declared/derived origin. */
export const riskAssessmentSchema = z.strictObject({
  level: z.enum(RISK_LEVELS),
  origin: z.enum(SCOPE_ORIGINS),
});

/**
 * Package trace id: bounded, whitespace-free, attributable. Accepts the
 * assembler's deterministic form (`ctx-trace-<hex>`), caller-supplied
 * correlation ids (e.g. UUIDs) and epoch trace ids alike.
 */
export const traceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "trace id must be a bounded token without whitespace");

/** The complete context-package contract (closed shape — no extra keys). */
export const contextPackageSchema = z.strictObject({
  memory_scope: scopeRecordSchema,
  data_scope: scopeRecordSchema,
  risk_level: riskAssessmentSchema,
  trace_id: traceIdSchema,
});

export type ContextScopeWireRecord = z.infer<typeof scopeRecordSchema>;
export type ContextRiskWireAssessment = z.infer<typeof riskAssessmentSchema>;
export type ContextPackage = z.infer<typeof contextPackageSchema>;

/* ─────────────────────────────────────────────────────────────
 * Completeness verdict
 * ────────────────────────────────────────────────────────────*/

export interface CompletenessIssue {
  /** The field the issue belongs to; null for package-level shape issues. */
  field: CompletenessField | null;
  path: string;
  message: string;
}

/**
 * Fail-closed verdict: `ok: true` only when all four fields are present and
 * well-formed. On failure the verdict names exactly which fields are missing
 * and which are malformed — incompleteness is never reduced to a bare boolean.
 */
export type PackageCompletenessVerdict =
  | { ok: true; package: ContextPackage }
  | {
      ok: false;
      /** `invalid_shape`: not a package-shaped object (or unknown keys). `incomplete`: fields missing/malformed. */
      reason: "invalid_shape" | "incomplete";
      missing: readonly CompletenessField[];
      malformed: readonly CompletenessIssue[];
      issues: readonly CompletenessIssue[];
    };

const INCOMPLETE_FIELDS: readonly CompletenessField[] = COMPLETENESS_FIELDS;

function issuePath(field: CompletenessField | null, path: readonly PropertyKey[]): string {
  const suffix = path.map((segment) => String(segment)).join(".");
  return suffix.length > 0 ? `${field ?? "package"}.${suffix}` : (field ?? "package");
}

/** Validates one field's value; returns the first issue, or null when well-formed. */
function fieldIssue(field: CompletenessField, value: unknown): CompletenessIssue | null {
  const result =
    field === "memory_scope" || field === "data_scope"
      ? scopeRecordSchema.safeParse(value)
      : field === "risk_level"
        ? riskAssessmentSchema.safeParse(value)
        : traceIdSchema.safeParse(value);
  if (result.success) return null;
  const first = result.error.issues[0];
  return {
    field,
    path: issuePath(field, first?.path ?? []),
    message: first?.message ?? "field is malformed",
  };
}

function issuesFromZod(
  error: z.ZodError,
  fallbackField: CompletenessField | null,
): CompletenessIssue[] {
  return error.issues.map((issue) => ({
    field: fallbackField,
    path: issuePath(fallbackField, issue.path),
    message: issue.message,
  }));
}

/**
 * Prove that a context package carries `memory_scope`, `data_scope`,
 * `risk_level` and `trace_id`, all present and well-formed. Fails closed:
 * anything that is not a complete package is rejected with a structured,
 * per-field verdict.
 */
export function checkContextPackageCompleteness(input: unknown): PackageCompletenessVerdict {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      reason: "invalid_shape",
      missing: INCOMPLETE_FIELDS,
      malformed: [],
      issues: [],
    };
  }

  const record = input as Record<string, unknown>;
  const missing: CompletenessField[] = [];
  const malformed: CompletenessIssue[] = [];

  for (const field of COMPLETENESS_FIELDS) {
    const value = record[field];
    if (value === undefined) {
      missing.push(field);
      continue;
    }
    const issue = fieldIssue(field, value);
    if (issue !== null) malformed.push(issue);
  }

  if (missing.length > 0 || malformed.length > 0) {
    return { ok: false, reason: "incomplete", missing, malformed, issues: [...malformed] };
  }

  // All four fields parse individually; the strict full parse now rejects
  // package-level unknown keys only.
  const parsed = contextPackageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      missing: [],
      malformed: [],
      issues: issuesFromZod(parsed.error, null),
    };
  }
  return { ok: true, package: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Adapter from the governed assembler envelope (read-only)
 * ────────────────────────────────────────────────────────────*/

/**
 * Map an assembled `ContextEnvelope` (camelCase, `../context-assembly`) onto
 * the wire package this checker validates. Returns null for a rejected
 * envelope — a rejected assembly has no scope statement to prove. Type-only
 * import: this module never executes assembler code.
 */
export function wirePackageFromEnvelope(envelope: ContextEnvelope): ContextPackage | null {
  if (envelope.kind !== "assembled") return null;
  return {
    memory_scope: {
      domains: [...envelope.memoryScope.domains],
      max_sensitivity: envelope.memoryScope.maxSensitivity,
      origin: envelope.memoryScope.origin,
    },
    data_scope: {
      domains: [...envelope.dataScope.domains],
      max_sensitivity: envelope.dataScope.maxSensitivity,
      origin: envelope.dataScope.origin,
    },
    risk_level: { level: envelope.riskLevel.level, origin: envelope.riskLevel.origin },
    trace_id: envelope.traceId,
  };
}

/**
 * Prove completeness of an assembled envelope directly. A rejected envelope
 * fails closed with every completeness field reported missing.
 */
export function checkEnvelopeCompleteness(envelope: ContextEnvelope): PackageCompletenessVerdict {
  const wire = wirePackageFromEnvelope(envelope);
  if (wire === null) {
    return {
      ok: false,
      reason: "invalid_shape",
      missing: INCOMPLETE_FIELDS,
      malformed: [],
      issues: [],
    };
  }
  return checkContextPackageCompleteness(wire);
}