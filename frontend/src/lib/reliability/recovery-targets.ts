/**
 * CoreGrid — recovery-target declaration contract: RTO/RPO per record family
 * (M-R-101 groundwork; H3 wave Squad A, mission A-002).
 *
 * WHAT: A Zod-validated contract binding record families to recovery
 * commitments — a recovery time objective (RTO: the maximum tolerated span
 * from disruption to restored service) and a recovery point objective (RPO:
 * the maximum tolerated span of unrecoverable data loss) — plus a registry
 * that groups declarations under an optional, tighter recovery envelope.
 *
 * Laws of this module:
 * - One binding per record family, and it must be COMPLETE: both RTO and
 *   RPO are required, together with provenance (who declared it, under
 *   which authority, when — AGENTS §12). There are no partial commitments
 *   and no anonymous commitments.
 * - Bounded windows: every duration is a positive whole number of minutes
 *   under a hard ceiling. No unbounded ("infinite recovery") commitments.
 * - Fail-closed defaults: an UNDECLARED record family resolves to
 *   `undeclared` — no recovery commitment is assumed, no permissive default
 *   is inherited. Drill and restore planning must treat undeclared families
 *   as uncovered; coverage gaps are named, never silent.
 * - Fail-closed parsing: an input that violates any invariant yields a typed
 *   failure with structured issues. No partial registry is ever returned
 *   from a failed parse.
 * - Registries must be produced by `parseRecoveryTargets`; resolution
 *   functions assume an already-parsed registry and do not re-validate.
 *
 * Neutral vocabulary only (J-037 shrink-only): a "record family" is any
 * named class of governed records. No domain vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded recovery commitments)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on any RTO declaration, in minutes. */
export const RTO_CEILING_MINUTES = 1_440;

/** Hard ceiling on any RPO declaration, in minutes. */
export const RPO_CEILING_MINUTES = 1_440;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const RECORD_FAMILY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const recordFamilySchema = z
  .string()
  .regex(
    RECORD_FAMILY_PATTERN,
    "recordFamily must be a lowercase snake_case identifier (letters, digits, underscore; starts with a letter; at most 64 characters)",
  );

export type RecordFamily = z.infer<typeof recordFamilySchema>;

function nonEmptyString(label: string) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

export const recoveryProvenanceSchema = z.strictObject({
  /** Who made the declaration (role or principal reference, not a secret). */
  declaredBy: nonEmptyString("provenance.declaredBy"),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: nonEmptyString("provenance.authority"),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type RecoveryProvenance = z.infer<typeof recoveryProvenanceSchema>;

const rtoMinutesSchema = z
  .number()
  .int()
  .positive()
  .max(
    RTO_CEILING_MINUTES,
    `rtoMinutes exceeds the bounded ceiling of ${RTO_CEILING_MINUTES} minutes (no unbounded recovery commitments)`,
  );

const rpoMinutesSchema = z
  .number()
  .int()
  .positive()
  .max(
    RPO_CEILING_MINUTES,
    `rpoMinutes exceeds the bounded ceiling of ${RPO_CEILING_MINUTES} minutes (no unbounded recovery commitments)`,
  );

export const recoveryTargetDeclarationSchema = z.strictObject({
  recordFamily: recordFamilySchema,
  /** Maximum tolerated span from disruption to restored service, in minutes. */
  rtoMinutes: rtoMinutesSchema,
  /** Maximum tolerated span of unrecoverable data loss, in minutes. */
  rpoMinutes: rpoMinutesSchema,
  provenance: recoveryProvenanceSchema,
});

export type RecoveryTargetDeclaration = z.infer<typeof recoveryTargetDeclarationSchema>;

/**
 * Optional per-registry envelope: tighter bounds that every declaration in
 * the registry must respect. The envelope can only narrow the global
 * ceilings, never widen them (enforced structurally by the same ceiling).
 */
export const recoveryEnvelopeSchema = z.strictObject({
  maxRtoMinutes: z
    .number()
    .int()
    .positive()
    .max(
      RTO_CEILING_MINUTES,
      `envelope maxRtoMinutes exceeds the bounded ceiling of ${RTO_CEILING_MINUTES} minutes`,
    ),
  maxRpoMinutes: z
    .number()
    .int()
    .positive()
    .max(
      RPO_CEILING_MINUTES,
      `envelope maxRpoMinutes exceeds the bounded ceiling of ${RPO_CEILING_MINUTES} minutes`,
    ),
});

export type RecoveryEnvelope = z.infer<typeof recoveryEnvelopeSchema>;

export const recoveryTargetRegistrySchema = z.strictObject({
  envelope: recoveryEnvelopeSchema.optional(),
  declarations: z
    .array(recoveryTargetDeclarationSchema)
    .max(1_024, "registry exceeds the bounded maximum of 1024 declarations"),
});

export type RecoveryTargetRegistry = z.infer<typeof recoveryTargetRegistrySchema>;

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial registries)
 * ────────────────────────────────────────────────────────────*/

export type RecoveryTargetParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate family, envelope breach). */
  | "cross_record_invariant";

export interface RecoveryTargetIssue {
  readonly path: string;
  readonly message: string;
}

export type RecoveryTargetParseResult =
  | { readonly ok: true; readonly registry: RecoveryTargetRegistry }
  | {
      readonly ok: false;
      readonly reason: RecoveryTargetParseFailureReason;
      readonly issues: readonly RecoveryTargetIssue[];
    };

function issuePath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Parse an untrusted input into a recovery-target registry. Any violation —
 * shape, bounds, duplicates, envelope breaches — yields `ok: false` with
 * structured issues; a failed parse never yields a partial registry.
 */
export function parseRecoveryTargets(input: unknown): RecoveryTargetParseResult {
  const parsed = recoveryTargetRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    };
  }

  const registry = parsed.data;
  const issues: RecoveryTargetIssue[] = [];

  const seen = new Set<RecordFamily>();
  for (const declaration of registry.declarations) {
    if (seen.has(declaration.recordFamily)) {
      issues.push({
        path: `declarations[recordFamily=${declaration.recordFamily}]`,
        message: `duplicate declaration for record family "${declaration.recordFamily}" — one family carries exactly one binding`,
      });
    } else {
      seen.add(declaration.recordFamily);
    }
  }

  const envelope = registry.envelope ?? null;
  if (envelope !== null) {
    for (const declaration of registry.declarations) {
      if (declaration.rtoMinutes > envelope.maxRtoMinutes) {
        issues.push({
          path: `declarations[recordFamily=${declaration.recordFamily}].rtoMinutes`,
          message: `rtoMinutes ${declaration.rtoMinutes} exceeds the registry envelope maximum ${envelope.maxRtoMinutes}`,
        });
      }
      if (declaration.rpoMinutes > envelope.maxRpoMinutes) {
        issues.push({
          path: `declarations[recordFamily=${declaration.recordFamily}].rpoMinutes`,
          message: `rpoMinutes ${declaration.rpoMinutes} exceeds the registry envelope maximum ${envelope.maxRpoMinutes}`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }

  return { ok: true, registry };
}

/**
 * The bounds a registry actually enforces: its declared envelope when
 * present, otherwise the global ceilings. This is a bounds default, not a
 * commitment default — it widens nothing that a family is promised, it only
 * names the envelope declarations must fit inside.
 */
export function effectiveEnvelope(registry: RecoveryTargetRegistry): RecoveryEnvelope {
  return (
    registry.envelope ?? { maxRtoMinutes: RTO_CEILING_MINUTES, maxRpoMinutes: RPO_CEILING_MINUTES }
  );
}

/* ─────────────────────────────────────────────────────────────
 * Resolution (fail-closed defaults)
 * ────────────────────────────────────────────────────────────*/

export const FAIL_CLOSED_UNDECLARED_DETAIL =
  "fail-closed default: no RTO/RPO declaration exists for this record family, so no recovery commitment is assumed — drill and restore planning must treat the family as uncovered rather than inheriting a permissive default";

export type RecoveryTargetResolution =
  | {
      readonly status: "declared";
      readonly family: RecordFamily;
      readonly declaration: RecoveryTargetDeclaration;
    }
  | {
      readonly status: "undeclared";
      readonly family: RecordFamily;
      readonly reason: "no_declaration_for_family";
      readonly detail: string;
    };

/**
 * Resolve one record family against a parsed registry. The undeclared case
 * is the fail-closed default: it never fabricates a target.
 */
export function resolveRecoveryTarget(
  registry: RecoveryTargetRegistry,
  family: RecordFamily,
): RecoveryTargetResolution {
  const declaration =
    registry.declarations.find((candidate) => candidate.recordFamily === family) ?? null;
  if (declaration === null) {
    return {
      status: "undeclared",
      family,
      reason: "no_declaration_for_family",
      detail: FAIL_CLOSED_UNDECLARED_DETAIL,
    };
  }
  return { status: "declared", family, declaration };
}

/* ─────────────────────────────────────────────────────────────
 * Coverage (gaps are named, never silent)
 * ────────────────────────────────────────────────────────────*/

export interface FamilyCoverage {
  readonly family: RecordFamily;
  readonly status: "declared" | "undeclared";
  readonly rtoMinutes: number | null;
  readonly rpoMinutes: number | null;
}

/** Explicit per-family coverage view over the requested families. */
export function coverageForFamilies(
  registry: RecoveryTargetRegistry,
  families: readonly RecordFamily[],
): readonly FamilyCoverage[] {
  return families.map((family) => {
    const resolution = resolveRecoveryTarget(registry, family);
    if (resolution.status === "declared") {
      return {
        family,
        status: "declared" as const,
        rtoMinutes: resolution.declaration.rtoMinutes,
        rpoMinutes: resolution.declaration.rpoMinutes,
      };
    }
    return { family, status: "undeclared" as const, rtoMinutes: null, rpoMinutes: null };
  });
}

export function undeclaredFamilies(
  registry: RecoveryTargetRegistry,
  families: readonly RecordFamily[],
): readonly RecordFamily[] {
  return families.filter(
    (family) => resolveRecoveryTarget(registry, family).status === "undeclared",
  );
}

export interface CoverageGapResult {
  /** True only when every requested family is declared. */
  readonly ok: boolean;
  readonly undeclared: readonly RecordFamily[];
  readonly detail: string | null;
}

/**
 * Fail-closed coverage audit over a set of required families: any gap is
 * reported explicitly with a structured result — never silently absorbed.
 */
export function coverageGaps(
  registry: RecoveryTargetRegistry,
  families: readonly RecordFamily[],
): CoverageGapResult {
  const undeclared = undeclaredFamilies(registry, families);
  if (undeclared.length === 0) {
    return { ok: true, undeclared: [], detail: null };
  }
  return {
    ok: false,
    undeclared,
    detail: `coverage incomplete: ${undeclared.length} of ${families.length} requested record families are undeclared (${undeclared.join(", ")}) — fail-closed: uncovered families carry no recovery commitment`,
  };
}