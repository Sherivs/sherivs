#!/usr/bin/env node
/**
 * SHERIVS-RLS-IMPLEMENTATION-PREP-001
 *
 * Fail closed if a staging RLS harness is pointed at production.
 * This module is importable from tests and from future staging runners.
 *
 * It never connects to a database and never prints secrets.
 */

export const PRODUCTION_SUPABASE_REF = "nwrflbpbhyiqdptmlccm";

export const PRODUCTION_HOST_MARKERS = Object.freeze([
  "nwrflbpbhyiqdptmlccm.supabase.co",
  "www.sherivs.com",
  "app.sherivs.com",
  "console.sherivs.com",
  "sherivs.com",
]);

/**
 * @param {string | undefined | null} raw
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertNotProductionTarget(raw) {
  if (!raw || !String(raw).trim()) {
    return { ok: false, reason: "empty_target" };
  }
  const value = String(raw).toLowerCase();
  if (value.includes(PRODUCTION_SUPABASE_REF)) {
    return { ok: false, reason: "canonical_production_supabase_ref" };
  }
  for (const marker of PRODUCTION_HOST_MARKERS) {
    if (value.includes(marker.toLowerCase())) {
      return { ok: false, reason: `production_host:${marker}` };
    }
  }
  return { ok: true };
}

function main() {
  const target =
    process.env.SHERIVS_RLS_STAGING_URL ||
    process.env.STAGING_DATABASE_URL ||
    process.env.STAGING_SUPABASE_URL ||
    "";
  const result = assertNotProductionTarget(target);
  if (!result.ok) {
    console.error(
      "REFUSED: staging RLS harness must not target production.",
      result.reason,
    );
    process.exit(2);
  }
  if (!target) {
    console.error(
      "MISSING PREREQUISITE: no staging URL in SHERIVS_RLS_STAGING_URL, STAGING_DATABASE_URL, or STAGING_SUPABASE_URL.",
    );
    process.exit(3);
  }
  console.log("STAGING_TARGET_OK");
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("assert-not-production.mjs") ||
    process.argv[1].includes("assert-not-production"));

if (isDirect) {
  main();
}
