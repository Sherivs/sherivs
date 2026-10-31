/**
 * Sherivs — placeholder-page disposition registry (V1CAP-40, mission V1-011).
 *
 * Typed audit record of the §57 no-product-theatre disposition pass over the
 * portal's zero-state pages. Every page that previously rendered fabricated
 * statics (static zeros posing as data, disabled fake actions, invented
 * intelligence metrics) is classified here:
 *
 *   - V1_BUILD       — the page covers a V1 capability and now reads real
 *                      data through server functions over existing
 *                      RLS-protected tables (`portal-overview.functions.ts`);
 *   - V2_CLASSIFIED  — the page is real future scope; it renders an honest
 *                      "planned capability — not in V1" state (no numbers, no
 *                      fake actions) via `PlannedCapabilityState`;
 *   - AUDITED_REAL   — the page was flagged by discovery as a placeholder but
 *                      audit found it already real (DB-backed or an honest
 *                      self-report surface); no change was needed.
 *
 * A static zero that pretends to be data is a violation; an honest "no data
 * yet" state is correct. This registry is the program's audit surface for
 * that law.
 */

export const PLACEHOLDER_DISPOSITION_MISSION = "V1-011" as const;

export type PlaceholderDisposition = "V1_BUILD" | "V2_CLASSIFIED" | "AUDITED_REAL";

export interface PlaceholderDispositionEntry {
  /** Portal route path as registered by the router. */
  route: string;
  /** Source file of the route, relative to the repository root. */
  file: string;
  title: string;
  disposition: PlaceholderDisposition;
  /**
   * V1_BUILD: the existing DB tables that back the page.
   * V2_CLASSIFIED: the fabricated content that was removed.
   * AUDITED_REAL: the evidence that the page was already real.
   */
  evidence: string;
  /** V2_CLASSIFIED only: the capability's planned state, stated in the open. */
  plannedCapability?: string;
  /** The frozen V1 envelope reason for a V2 classification (§45). */
  versionTargetNote?: string;
}

export const PLACEHOLDER_DISPOSITIONS: readonly PlaceholderDispositionEntry[] = [
  // Portal placeholder pages lived in the hardcoded school/console shells.
  // Those routes were removed; the registry is empty until a new workspace UI exists.
];

/* ─────────────────────────────────────────────────────────────
 * Validation — the registry audits itself (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export interface DispositionValidationResult {
  ok: boolean;
  issues: string[];
}

export function validatePlaceholderDispositions(): DispositionValidationResult {
  const issues: string[] = [];
  const seenRoutes = new Set<string>();
  const seenFiles = new Set<string>();

  for (const entry of PLACEHOLDER_DISPOSITIONS) {
    const at = `entry ${entry.route}`;
    if (seenRoutes.has(entry.route)) issues.push(`${at}: duplicate route`);
    if (seenFiles.has(entry.file)) issues.push(`${at}: duplicate file`);
    seenRoutes.add(entry.route);
    seenFiles.add(entry.file);

    if (!entry.route.startsWith("/")) issues.push(`${at}: route must be absolute`);
    if (!entry.file.startsWith("frontend/src/routes/")) {
      issues.push(`${at}: file must live under frontend/src/routes/`);
    }
    if (entry.file.includes("(site)")) {
      issues.push(`${at}: (site) routes are owned by another mission`);
    }
    if (entry.evidence.trim() === "") issues.push(`${at}: evidence must not be empty`);

    if (entry.disposition === "V2_CLASSIFIED" && !entry.plannedCapability) {
      issues.push(`${at}: V2_CLASSIFIED entries must state the planned capability`);
    }
    if (entry.disposition !== "V2_CLASSIFIED" && entry.plannedCapability) {
      issues.push(`${at}: only V2_CLASSIFIED entries carry a planned capability`);
    }
    if (
      entry.disposition === "V1_BUILD" &&
      !entry.evidence.includes("portal-overview.functions.ts") &&
      !entry.evidence.includes("table")
    ) {
      issues.push(`${at}: V1_BUILD entries must cite the real tables backing the page`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Count entries by disposition — the audit summary for the program. */
export function dispositionCounts(): Record<PlaceholderDisposition, number> {
  const counts: Record<PlaceholderDisposition, number> = {
    V1_BUILD: 0,
    V2_CLASSIFIED: 0,
    AUDITED_REAL: 0,
  };
  for (const entry of PLACEHOLDER_DISPOSITIONS) counts[entry.disposition] += 1;
  return counts;
}
