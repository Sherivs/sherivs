/**
 * Sherivs brand migration — machine-readable classification (V1).
 *
 * Every existing `CoreGrid` reference in the repository belongs to exactly
 * one class. Only CUSTOMER_FACING references may be migrated to Sherivs.
 * TECHNICAL references are compatibility surface and must be preserved.
 *
 * Full human-readable audit: SHERIVS_BRAND_MIGRATION.md (repo root).
 *
 * Version-target classification: V1.
 */

/** A single classified reference family. */
export interface BrandReferenceFamily {
  /** Stable identifier for the family. */
  id: string;
  /** CUSTOMER_FACING references render Sherivs; TECHNICAL references stay. */
  class: "CUSTOMER_FACING" | "TECHNICAL";
  /** What matches this family (paths, identifiers or patterns). */
  pattern: string;
  /** Why this classification holds. */
  rationale: string;
}

export const BRAND_REFERENCE_FAMILIES: readonly BrandReferenceFamily[] = [
  {
    id: "public-site-copy",
    class: "CUSTOMER_FACING",
    pattern: "frontend/src/routes/(site)/** — rendered marketing copy, titles, meta",
    rationale: "Visitors read this as the vendor brand; Sherivs is canonical.",
  },
  {
    id: "platform-public-page",
    class: "CUSTOMER_FACING",
    pattern: "frontend/src/routes/platform.tsx — header wordmark and document meta",
    rationale: "Public platform page; the vendor brand shown must be Sherivs.",
  },
  {
    id: "document-head",
    class: "CUSTOMER_FACING",
    pattern: "frontend/src/routes/__root.tsx head — app title, mobile web-app title",
    rationale: "Rendered in browser chrome and home-screen installs.",
  },
  {
    id: "auth-surface",
    class: "CUSTOMER_FACING",
    pattern: "frontend/src/routes/auth.tsx — headings and portal-access copy",
    rationale: "First-run customer surface; vendor brand must be Sherivs.",
  },
  {
    id: "database-objects",
    class: "TECHNICAL",
    pattern: "cg_* tables, RLS policies, database/functions/**, database/supabase/migrations/**",
    rationale: "Renaming breaks RLS, migrations replay and audit continuity.",
  },
  {
    id: "package-identity",
    class: "TECHNICAL",
    pattern: "@coregrid/contracts, coregrid-scholar package name, import specifiers",
    rationale: "Renaming breaks installs, lockfiles and registry validation.",
  },
  {
    id: "kernel-vocabulary",
    class: "TECHNICAL",
    pattern: "@/lib/kernel/**, phase contracts, registry.json, architecture/** identifiers",
    rationale: "Kernel vocabulary is the preserved master architecture (V5.1/V5.2).",
  },
  {
    id: "code-identifiers",
    class: "TECHNICAL",
    pattern: "Type/interface/file names containing coregrid (types/coregrid-scholar.ts, route ids)",
    rationale: "Renaming identifiers is destructive refactoring without a migration plan.",
  },
  {
    id: "audit-records",
    class: "TECHNICAL",
    pattern: "Stored audit rows, decision ledgers, evidence artifacts",
    rationale: "Canonical truth: history must keep the name recorded at write time.",
  },
  {
    id: "internal-workspace",
    class: "TECHNICAL",
    pattern: "Internal/operator surfaces describing kernel internals (command-centre internals)",
    rationale:
      "Operator vocabulary for the preserved kernel; customer rebrand happens at the shell, not in kernel copy.",
  },
];

const TECHNICAL_FAMILY_IDS: ReadonlySet<string> = new Set(
  BRAND_REFERENCE_FAMILIES.filter((family) => family.class === "TECHNICAL").map(
    (family) => family.id,
  ),
);

/**
 * Guard: a migration is authorized only for CUSTOMER_FACING families.
 * Unknown family ids are denied (closed world — no blind replacement).
 */
export function isMigrationAuthorized(familyId: string): boolean {
  const family = BRAND_REFERENCE_FAMILIES.find((entry) => entry.id === familyId);
  if (!family) return false;
  return !TECHNICAL_FAMILY_IDS.has(family.id);
}

/**
 * Guard: technical identifier strings must never be rewritten by a
 * customer-facing brand pass. Used by tests and by any future codemod.
 */
const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /^cg_/,
  /@coregrid\//,
  /coregrid-scholar/,
  /types\/coregrid-/,
  /database\//,
  /migrations\//,
  /registry\.json$/,
];

export function isTechnicalIdentifier(value: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(value));
}
