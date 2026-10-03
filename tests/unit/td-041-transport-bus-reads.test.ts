/**
 * T-D — driver bus-read policy (post-R-wave follow-up wave, TEAM T-D).
 *
 * Internal-consistency proof for the AUTHORED (not applied) migration
 * 20261003000041_coregrid_transport_bus_reads.sql and its exact-inverse
 * rollback, and for the posture-registry ratchet
 * (scripts/verification/rls-table-postures-transport.json):
 *
 *   1. flow traceability — the policy predicate is derived from the ACTUAL
 *      read the driver surface performs (getMyDriverBus), which runs
 *      client-mediated under the user's JWT (requireSupabaseAuth), so a
 *      client policy is genuinely required;
 *   2. least privilege — SELECT-only, one policy, authenticated SELECT and
 *      nothing else, zero anon/PUBLIC privileges, FORCE RLS, service_role
 *      untouched, no schema invented (the assignment linkage is the existing
 *      driver_id column);
 *   3. J-005/J-006 predicate law — no legacy domain helper, no domain role
 *      name literal, no client-trusted value; the actor is re-derived from
 *      auth.uid() inside the predicate;
 *   4. the rollback is the genuine exact inverse (restores the 20261002000014
 *      zero-policy posture verbatim, comment included);
 *   5. the posture registry resolves the NEW policy-backed entry through the
 *      battery's fail-closed validation (validatePostureEntry) and the merged
 *      registry, with the honest §4.4 probe-recipe limitation recorded.
 *
 * READ-ONLY and fully offline: no database, no network, no secrets. Nothing
 * here applies anything — the live isolation proof is the coordinator's
 * post-apply battery re-run.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS verification script imported into the TS unit suite (read-only module import; same pattern as tests/unit/h3-031-posture-adjudication.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const MIGRATION_REL = "database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql";
const ROLLBACK_REL = "database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql";
const POSTURE_REL = "scripts/verification/rls-table-postures-transport.json";
const ZERO_POLICY_MIGRATION_REL =
  "database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql";
const DRIVER_FLOW_REL = "frontend/src/lib/runtime/scholar/driver-portal.functions.ts";
const AUTH_MIDDLEWARE_REL = "frontend/src/integrations/supabase/auth-middleware.ts";

const POLICY_NAME = "transport_buses_select_driver_assigned";
const BASENAME = "20261003000041_coregrid_transport_bus_reads.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_REL), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_REL), "utf8");
const POSTURE = JSON.parse(readFileSync(join(ROOT, POSTURE_REL), "utf8")) as {
  migration?: string;
  rollback?: string;
  tables?: Array<{
    name?: string;
    posture?: string;
    policies?: string[];
    tenantColumn?: string;
    forceRls?: boolean;
    policyBackedBy?: string;
    normalizedBy?: string;
    sourceMigration?: string;
    privileges?: { anon?: string[]; authenticated?: string[]; PUBLIC?: string[]; service_role?: string[] };
  }>;
  batteryExpectations?: {
    zeroPolicyTables?: string[];
    policyBackedTables?: string[];
    probeRecipeNote?: string;
  };
};
const ZERO_POLICY_MIGRATION = readFileSync(join(ROOT, ZERO_POLICY_MIGRATION_REL), "utf8");
const DRIVER_FLOW = readFileSync(join(ROOT, DRIVER_FLOW_REL), "utf8");
const AUTH_MIDDLEWARE = readFileSync(join(ROOT, AUTH_MIDDLEWARE_REL), "utf8");

const battery = batteryMjs as unknown as {
  BUILTIN_TABLE_POSTURES: Array<{ name: string; posture: string }>;
  loadPostureRegistry: (dir: string) => {
    tables: Array<{
      name: string;
      posture: string;
      postureSource?: string;
      policies: string[];
      forceRls?: boolean;
      tenantColumn?: string;
      policyBackedBy?: string;
    }>;
    files: string[];
    fallbackUsed: boolean;
    added: string[];
  };
  validatePostureEntry: (entry: unknown, fileName: string) => {
    name: string;
    posture: string;
    policies: string[];
    forceRls?: boolean;
    tenantColumn?: string;
  };
};

describe("T-D driver bus-read policy — artifacts exist with the mandated basename pair", () => {
  it("the migration and its exact-inverse rollback exist under the same basename", () => {
    expect(existsSync(join(ROOT, MIGRATION_REL))).toBe(true);
    expect(existsSync(join(ROOT, ROLLBACK_REL))).toBe(true);
    expect(MIGRATION_REL.split("/").pop()).toBe(BASENAME);
    expect(ROLLBACK_REL.split("/").pop()).toBe(BASENAME);
  });

  it("neither file claims to be applied — AUTHORED, NOT APPLIED is the mission's posture", () => {
    expect(MIGRATION).toMatch(/AUTHORED, NOT APPLIED/);
    expect(ROLLBACK).toMatch(/EXACT INVERSE ROLLBACK/);
  });
});

describe("T-D flow traceability — the policy is derived from the actual UI/flow, not guesswork", () => {
  it("the driver surface reads transport_buses filtered by the acting identity and active flag", () => {
    expect(DRIVER_FLOW).toContain('.from("transport_buses")');
    expect(DRIVER_FLOW).toContain('.eq("driver_id", userId)');
    expect(DRIVER_FLOW).toContain('.eq("is_active", true)');
    expect(DRIVER_FLOW).toContain("maybeSingle()");
  });

  it("the read is client-mediated under the user's JWT — a client policy is genuinely required", () => {
    // requireSupabaseAuth builds the Supabase client from the PUBLISHABLE key
    // plus the request's own bearer token, i.e. the authenticated role — RLS
    // applies, so the honesty valve "service-role-mediated, no client policy"
    // does NOT fire.
    expect(AUTH_MIDDLEWARE).toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(AUTH_MIDDLEWARE).toContain("Bearer ${token}");
    expect(AUTH_MIDDLEWARE).toContain("supabase.auth.getClaims(token)");
  });
});

describe("T-D least privilege — SELECT-only, one policy, forced RLS, no schema invented", () => {
  it("grants exactly SELECT to authenticated and nothing else to any client role", () => {
    expect(MIGRATION).toContain("GRANT SELECT ON TABLE public.transport_buses TO authenticated;");
    expect(MIGRATION).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^\n]*transport_buses/i,
    );
    expect(MIGRATION).not.toMatch(/GRANT[^\n]*transport_buses[^\n]*(anon|PUBLIC)/i);
  });

  it("authors exactly one policy: the driver self-assignment read bound to auth.uid()", () => {
    const policyBlock = MIGRATION.slice(
      MIGRATION.indexOf(`CREATE POLICY ${POLICY_NAME}`),
      MIGRATION.indexOf("DO $verify$"),
    );
    expect(policyBlock).toContain(`CREATE POLICY ${POLICY_NAME}`);
    expect(policyBlock).toContain("ON public.transport_buses");
    expect(policyBlock).toContain("FOR SELECT TO authenticated");
    expect(policyBlock).toContain("USING (driver_id = auth.uid())");
    expect((MIGRATION.match(/CREATE POLICY/g) ?? []).length).toBe(1);
  });

  it("force-binds RLS in the same migration that authors the policy (battery §2 / exemplar convention)", () => {
    expect(MIGRATION).toContain("ALTER TABLE public.transport_buses FORCE ROW LEVEL SECURITY;");
  });

  it("invents no schema: no new table, no new column, no linkage table", () => {
    expect(MIGRATION).not.toMatch(/CREATE TABLE/i);
    expect(MIGRATION).not.toMatch(/ADD COLUMN/i);
    expect(MIGRATION).not.toMatch(/CREATE POLICY[^\n]*ON public\.(?!transport_buses\b)\w+/);
  });

  it("leaves service_role untouched and never touches the zero-policy-era normalization migration's objects", () => {
    expect(MIGRATION).not.toMatch(/^(?:REVOKE|GRANT)[^\n]*service_role/im);
    expect(MIGRATION).not.toMatch(/^(?:REVOKE|GRANT)[^\n]*\banon\b/im);
    expect(MIGRATION).not.toMatch(/^(?:REVOKE|GRANT)[^\n]*\bPUBLIC\b/m);
    expect(MIGRATION).not.toMatch(/DROP POLICY/i);
  });

  it("carries a fail-closed apply guard asserting the exact declared posture", () => {
    expect(MIGRATION).toContain("DO $verify$");
    expect(MIGRATION).toContain("POSTURE VIOLATION");
    expect(MIGRATION).toContain(`'${POLICY_NAME}'`);
  });

  it("records the declared posture as machine-readable audit strings (exemplar §4 shape)", () => {
    expect(MIGRATION).toMatch(/COMMENT ON TABLE public\.transport_buses IS/);
    expect(MIGRATION).toMatch(new RegExp(`COMMENT ON POLICY ${POLICY_NAME} ON public\\.transport_buses IS`));
    expect(MIGRATION).toContain("$comment$");
  });
});

describe("T-D J-005/J-006 predicate law — nothing banned enters the policy layer", () => {
  it("never uses a legacy domain helper", () => {
    expect(MIGRATION).not.toMatch(/get_my_school_id|is_school_admin|is_super_admin/);
  });

  it("never uses a domain role name as a quoted literal and never hard-codes a tenant or identity", () => {
    expect(MIGRATION).not.toMatch(/['"`](driver|bus|parent|staff|admin)['"`]/i);
    expect(MIGRATION).not.toMatch(/role:/i);
    expect(MIGRATION).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("re-derives the actor inside the predicate from auth.uid() (the sanctioned self-derivation)", () => {
    expect(MIGRATION).toContain("auth.uid()");
  });

  it("stays clean under the shrink-only domain-neutrality guard's strict vocabulary", () => {
    expect(MIGRATION).not.toMatch(/\b(school|scholar|classroom|curriculum|exam|attendance|admission|enrollment|tuition|bursar|principal|guardian)\b/i);
    expect(MIGRATION).not.toMatch(/\bschool_id\b/);
  });
});

describe("T-D exact-inverse rollback — restores the 20261002000014 zero-policy posture verbatim", () => {
  it("drops the policy, revokes the SELECT privilege, and un-forces RLS", () => {
    expect(ROLLBACK).toContain(`DROP POLICY IF EXISTS ${POLICY_NAME}`);
    expect(ROLLBACK).toContain("ON public.transport_buses;");
    expect(ROLLBACK).toContain("REVOKE SELECT ON TABLE public.transport_buses FROM authenticated;");
    expect(ROLLBACK).toContain("ALTER TABLE public.transport_buses NO FORCE ROW LEVEL SECURITY;");
  });

  it("restores the zero-policy-era posture COMMENT verbatim from the 20261002000014 source", () => {
    const zeroPolicyComment = ZERO_POLICY_MIGRATION.slice(
      ZERO_POLICY_MIGRATION.indexOf("$comment$Posture declared by 20261002000014"),
      ZERO_POLICY_MIGRATION.lastIndexOf("$comment$;"),
    );
    expect(zeroPolicyComment.length).toBeGreaterThan(100);
    expect(ROLLBACK).toContain(zeroPolicyComment);
  });

  it("carries its own fail-closed guard re-asserting the zero-policy invariant", () => {
    expect(ROLLBACK).toContain("DO $verify$");
    expect(ROLLBACK).toContain("ROLLBACK VIOLATION");
  });

  it("grants nothing and revokes nothing beyond the forward migration's own state", () => {
    expect(ROLLBACK).not.toMatch(/GRANT[^\n]*transport_buses/i);
    expect(ROLLBACK).not.toMatch(/REVOKE[^\n]*service_role/i);
    expect(ROLLBACK).not.toMatch(/REVOKE[^\n]*anon/i);
  });
});

describe("T-D posture registry ratchet — transport_buses moves zero-policy → policy-backed", () => {
  const entry = (POSTURE.tables ?? []).find((t) => t.name === "transport_buses");

  it("declares transport_buses policy-backed, authored by 20261003000041", () => {
    expect(entry).toBeDefined();
    expect(entry?.posture).toBe("policy-backed");
    expect(entry?.policies).toEqual([POLICY_NAME]);
    expect(entry?.policyBackedBy).toBe(MIGRATION_REL);
    expect(entry?.normalizedBy).toBe(ZERO_POLICY_MIGRATION_REL);
    expect(entry?.sourceMigration).toBe(
      "database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql",
    );
  });

  it("declares the least-privilege privilege set: authenticated SELECT-only, zero anon/PUBLIC", () => {
    expect(entry?.forceRls).toBe(true);
    expect(entry?.tenantColumn).toBe("driver_id");
    expect(entry?.privileges?.authenticated).toEqual(["SELECT"]);
    expect(entry?.privileges?.anon ?? []).toEqual([]);
    expect(entry?.privileges?.PUBLIC ?? []).toEqual([]);
    expect(entry?.privileges?.service_role).toEqual(["ALL"]);
  });

  it("moves the table into the policy-backed battery expectation and out of the zero-policy one", () => {
    expect(POSTURE.batteryExpectations?.policyBackedTables).toEqual(["transport_buses"]);
    expect(POSTURE.batteryExpectations?.zeroPolicyTables ?? []).not.toContain("transport_buses");
  });

  it("records the honest §4.4 limitation: no runnable probe recipe exists for this legacy FK-bound substrate", () => {
    expect(POSTURE.batteryExpectations?.probeRecipeNote ?? "").toMatch(/no §4\.4 probeSeedRows/);
    expect(entry).not.toHaveProperty("probeSeedRows");
    expect(entry).not.toHaveProperty("probeInsertPayload");
  });

  it("survives the battery's fail-closed validation gate and the merged-registry resolution", () => {
    expect(entry).toBeDefined();
    const validated = battery.validatePostureEntry(entry, "rls-table-postures-transport.json");
    expect(validated.posture).toBe("policy-backed");
    expect(validated.policies).toEqual([POLICY_NAME]);
    expect(validated.forceRls).toBe(true);

    const registry = battery.loadPostureRegistry(join(ROOT, "scripts", "verification"));
    const resolved = registry.tables.find((t) => t.name === "transport_buses");
    expect(resolved?.posture).toBe("policy-backed");
    expect(resolved?.postureSource).toBe("rls-table-postures-transport.json");
    expect(resolved?.policies).toEqual([POLICY_NAME]);
    expect(resolved?.policyBackedBy).toBe(MIGRATION_REL);
    // Single source of truth: transport_buses is a posture-file table, never
    // a builtin-canonical one.
    expect(battery.BUILTIN_TABLE_POSTURES.some((t) => t.name === "transport_buses")).toBe(false);
    expect(registry.added).toContain("transport_buses");
  });

  it("points the artifact at the authored migration pair and marks it NOT APPLIED", () => {
    expect(POSTURE.migration).toBe(MIGRATION_REL);
    expect(POSTURE.rollback).toBe(ROLLBACK_REL);
  });
});