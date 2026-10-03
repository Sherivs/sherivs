/**
 * CoreGrid — backup manifest contract (Squad A / A-003, M-R-101 groundwork).
 *
 * A backup set is only as trustworthy as the manifest that describes it.
 * This module defines the typed, Zod-validated shape of a valid backup
 * manifest: WHAT it covers (scope), WHICH tenants' records are inside
 * (tenant coverage — multi-tenancy law: every artifact must carry tenant
 * context), WHEN it was taken and WHEN it stops being trustworthy
 * (instant + expiry), and HOW each artifact's integrity can be verified
 * (checksums).
 *
 * Law of this module:
 * - Fail closed: a manifest that is expired, not yet valid, missing any
 *   required field, or carrying an unverifiable checksum is NOT usable,
 *   and the reason is stated in a typed issue, never silently absorbed.
 * - Expiry is mandatory and bounded: a manifest must declare an expiry
 *   strictly after its instant, and validation can enforce a maximum
 *   retention window (backup-expiry discipline is adjudicated by ADR;
 *   this module only provides the bound, callers declare the value).
 * - Tenant coverage must be explicit: a manifest covering zero tenants,
 *   or duplicating a tenant ref, is rejected. Coverage is either the full
 *   declared tenant list or an explicitly partial one — "unknown coverage"
 *   does not parse.
 * - Checksums are structural until verified: this module validates the
 *   checksum FORMAT (algorithm + hex digest length); it never performs
 *   I/O or hashing itself (pure contract, offline-testable).
 * - Clock injection: all time flows from a caller-supplied `nowMs`.
 *   Nothing reads the wall clock implicitly.
 *
 * Pure contract module: no I/O, no persistence, no vendors, no secrets.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Bump on any breaking change to the manifest shape. */
export const BACKUP_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Checksum algorithms a manifest may declare. Digest lengths are enforced per algorithm. */
export const CHECKSUM_ALGORITHMS = ["sha256", "sha512"] as const;
export type ChecksumAlgorithm = (typeof CHECKSUM_ALGORITHMS)[number];

const CHECKSUM_DIGEST_HEX_LENGTH: Readonly<Record<ChecksumAlgorithm, number>> = {
  sha256: 64,
  sha512: 128,
};

/** What kind of content a manifest entry claims to carry (neutral vocabulary). */
export const BACKUP_ENTRY_KINDS = ["records", "attachments", "audit", "configuration"] as const;
export type BackupEntryKind = (typeof BACKUP_ENTRY_KINDS)[number];

/** Checksum schema: algorithm allowlist + per-algorithm hex digest length. */
export const ChecksumSchema = z.object({
  algorithm: z.enum(CHECKSUM_ALGORITHMS),
  digest: z
    .string()
    .regex(/^[0-9a-f]+$/, "checksum digest must be lowercase hex"),
});

export type Checksum = z.infer<typeof ChecksumSchema>;

/** One artifact inside the backup set. */
export const BackupEntrySchema = z.object({
  /** Stable identifier for the artifact within the set (must be unique). */
  entryId: z.string().min(1),
  /** Neutral content classification for the artifact. */
  kind: z.enum(BACKUP_ENTRY_KINDS),
  /**
   * Relative storage reference. Must be relative and MUST NOT traverse
   * upward: a manifest can never smuggle a path outside the backup set.
   */
  storageRef: z
    .string()
    .min(1)
    .refine((ref) => !ref.startsWith("/"), "storageRef must be relative")
    .refine(
      (ref) => ref.split("/").every((segment) => segment !== ".."),
      "storageRef must not traverse upward",
    ),
  byteSize: z.number().int().positive(),
  checksum: ChecksumSchema,
});

export type BackupEntry = z.infer<typeof BackupEntrySchema>;

/**
 * Scope: which record families the set claims to cover, with counts.
 * A family listed with count 0 is a DECLARED emptiness, which is honest;
 * an omitted family is simply not covered by this set.
 */
export const BackupScopeSchema = z.object({
  families: z
    .array(
      z.object({
        kind: z.enum(BACKUP_ENTRY_KINDS),
        recordCount: z.number().int().nonnegative(),
      }),
    )
    .min(1, "scope must declare at least one record family"),
});

export type BackupScope = z.infer<typeof BackupScopeSchema>;

/**
 * Tenant coverage: the explicit list of tenants whose records are inside
 * the set. `partial` must be true when the set deliberately covers only a
 * subset of a tenant's records; false means full coverage of every named
 * tenant. There is no "unknown" — a manifest that cannot state its
 * coverage does not parse.
 */
export const TenantCoverageSchema = z.object({
  tenants: z.array(z.string().min(1)).min(1, "tenant coverage must name at least one tenant"),
  partial: z.boolean(),
});

export type TenantCoverage = z.infer<typeof TenantCoverageSchema>;

/** The complete, typed backup manifest. Lifetime ordering is enforced in validation. */
export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(BACKUP_MANIFEST_SCHEMA_VERSION),
  /** Unique identity for this backup set. */
  manifestId: z.string().min(1),
  /** Instant the backup was taken (ms since epoch, caller-declared). */
  capturedAtMs: z.number().int().nonnegative(),
  /** Mandatory expiry: the set is untrustworthy after this instant. */
  expiresAtMs: z.number().int().nonnegative(),
  scope: BackupScopeSchema,
  tenantCoverage: TenantCoverageSchema,
  /** Every artifact in the set, each carrying its own checksum. */
  entries: z.array(BackupEntrySchema).min(1, "a backup set must contain at least one entry"),
  /** Checksum of the serialized manifest itself (provenance hook for the producer). */
  manifestChecksum: ChecksumSchema,
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed, typed issues)
 * ────────────────────────────────────────────────────────────*/

export type BackupManifestIssueCode =
  | "invalid_input"
  | "schema_version_unsupported"
  | "lifetime_inverted"
  | "expired"
  | "not_yet_valid"
  | "retention_window_exceeded"
  | "duplicate_entry"
  | "duplicate_tenant"
  | "checksum_digest_length"
  | "scope_family_duplicate";

export interface BackupManifestIssue {
  code: BackupManifestIssueCode;
  detail: string;
}

export type BackupManifestValidationResult =
  | { readonly ok: true; readonly manifest: BackupManifest }
  | { readonly ok: false; readonly issues: readonly BackupManifestIssue[] };

export interface ValidateBackupManifestOptions {
  /**
   * Caller-injected observation time (ms since epoch). Required for
   * freshness checks; when omitted, only shape/lifetime rules run and the
   * caller MUST NOT treat the result as "usable now".
   */
  nowMs?: number;
  /**
   * Maximum allowed lifetime (expiresAtMs − capturedAtMs) in ms. When
   * declared, a manifest living longer is rejected (retention discipline).
   */
  maxRetentionMs?: number;
}

/** Structural rules that Zod alone cannot express (cross-field invariants). */
function structuralIssues(manifest: BackupManifest): BackupManifestIssue[] {
  const issues: BackupManifestIssue[] = [];

  const seenEntries = new Set<string>();
  for (const entry of manifest.entries) {
    if (seenEntries.has(entry.entryId)) {
      issues.push({
        code: "duplicate_entry",
        detail: `entryId ${entry.entryId} appears more than once; each artifact must be named exactly once`,
      });
    }
    seenEntries.add(entry.entryId);

    const expectedLength = CHECKSUM_DIGEST_HEX_LENGTH[entry.checksum.algorithm];
    if (entry.checksum.digest.length !== expectedLength) {
      issues.push({
        code: "checksum_digest_length",
        detail: `entry ${entry.entryId}: ${entry.checksum.algorithm} digest must be exactly ${expectedLength} hex characters`,
      });
    }
  }

  const seenTenants = new Set<string>();
  for (const tenant of manifest.tenantCoverage.tenants) {
    if (seenTenants.has(tenant)) {
      issues.push({
        code: "duplicate_tenant",
        detail: `tenant ${tenant} is named more than once in tenant coverage`,
      });
    }
    seenTenants.add(tenant);
  }

  const seenFamilies = new Set<BackupEntryKind>();
  for (const family of manifest.scope.families) {
    if (seenFamilies.has(family.kind)) {
      issues.push({
        code: "scope_family_duplicate",
        detail: `scope declares record family ${family.kind} more than once`,
      });
    }
    seenFamilies.add(family.kind);
  }

  const expectedManifestDigestLength =
    CHECKSUM_DIGEST_HEX_LENGTH[manifest.manifestChecksum.algorithm];
  if (manifest.manifestChecksum.digest.length !== expectedManifestDigestLength) {
    issues.push({
      code: "checksum_digest_length",
      detail: `manifestChecksum: ${manifest.manifestChecksum.algorithm} digest must be exactly ${expectedManifestDigestLength} hex characters`,
    });
  }

  return issues;
}

/**
 * Validate a raw (untrusted) value as a backup manifest.
 *
 * Order matters: shape first (schema), then cross-field structural
 * invariants, then lifetime discipline against the injected clock. The
 * first failure class that fails closes the result; ALL collected issues
 * are reported, never truncated to the first.
 */
export function validateBackupManifest(
  raw: unknown,
  options: ValidateBackupManifestOptions = {},
): BackupManifestValidationResult {
  const parsed = BackupManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const isVersionProblem = parsed.error.issues.some(
      (issue) => issue.path.length === 1 && issue.path[0] === "schemaVersion",
    );
    return {
      ok: false,
      issues: [
        isVersionProblem
          ? {
              code: "schema_version_unsupported",
              detail: "manifest schemaVersion is not supported by this validator",
            }
          : {
              code: "invalid_input",
              detail: parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
                .join("; "),
            },
      ],
    };
  }

  const manifest = parsed.data;
  const issues = structuralIssues(manifest);

  const lifetimeMs = manifest.expiresAtMs - manifest.capturedAtMs;
  if (lifetimeMs <= 0) {
    issues.push({
      code: "lifetime_inverted",
      detail: "expiresAtMs must be strictly after capturedAtMs",
    });
  }
  if (options.maxRetentionMs !== undefined && lifetimeMs > options.maxRetentionMs) {
    issues.push({
      code: "retention_window_exceeded",
      detail: `manifest lifetime ${lifetimeMs}ms exceeds the declared maximum retention window ${options.maxRetentionMs}ms`,
    });
  }

  if (options.nowMs !== undefined) {
    if (manifest.capturedAtMs > options.nowMs) {
      issues.push({
        code: "not_yet_valid",
        detail: `manifest instant ${manifest.capturedAtMs} is after the observation time ${options.nowMs}; it cannot be trusted yet`,
      });
    }
    if (manifest.expiresAtMs <= options.nowMs) {
      issues.push({
        code: "expired",
        detail: `manifest expired at ${manifest.expiresAtMs} (observed at ${options.nowMs}); expired backup sets fail closed`,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest };
}

/* ─────────────────────────────────────────────────────────────
 * Queries (pure, clock-injected)
 * ────────────────────────────────────────────────────────────*/

/** The only status a usable manifest may report is "current". */
export type BackupManifestStatus = "current" | "expired" | "not_yet_valid";

export function backupManifestStatus(manifest: BackupManifest, nowMs: number): BackupManifestStatus {
  if (manifest.capturedAtMs > nowMs) return "not_yet_valid";
  if (manifest.expiresAtMs <= nowMs) return "expired";
  return "current";
}

/**
 * True when the set covers the given tenant. Coverage answers WHOSE
 * records are inside; it confers no access rights by itself.
 */
export function coversTenant(manifest: BackupManifest, tenantRef: string): boolean {
  return manifest.tenantCoverage.tenants.includes(tenantRef);
}

/** Total declared record count across all scoped families. */
export function declaredRecordCount(manifest: BackupManifest): number {
  return manifest.scope.families.reduce((sum, family) => sum + family.recordCount, 0);
}

/**
 * Confirm a checksum's structural shape against a known algorithm. This
 * is format validation only — actual integrity verification happens at
 * the storage layer against the artifact bytes.
 */
export function isWellFormedChecksum(checksum: Checksum): boolean {
  const parsed = ChecksumSchema.safeParse(checksum);
  if (!parsed.success) return false;
  return parsed.data.digest.length === CHECKSUM_DIGEST_HEX_LENGTH[parsed.data.algorithm];
}
