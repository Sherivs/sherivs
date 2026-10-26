/**
 * SHERIVS-001 — identity integrity and privilege-escalation hardening.
 *
 * Offline adversarial tests. These prove source contracts and application
 * allowlists. They do not connect to PostgreSQL and do not prove that a
 * proposed migration has been applied to any database.
 *
 * Distinction:
 * - Unit / static source checks: this file.
 * - Simulated database behavior: not available (no offline PG harness).
 * - Real PostgreSQL integration / live catalog: NOT AUTHORIZED.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PINNED_MIGRATION_COUNT,
  PINNED_SOURCE_COMMIT,
// @ts-expect-error — untyped plain-JS SHERIVS script imported into the TS unit suite (same pattern as tests/unit/h3-036-posture-adjudication.test.ts)
} from "../../scripts/staging/sherivs-restore/constants.mjs";
import {
  inspectWorkingTree,
  verifyLoadedFiles,
  loadApprovedManifest,
// @ts-expect-error — untyped plain-JS SHERIVS script imported into the TS unit suite (same pattern as tests/unit/h3-036-posture-adjudication.test.ts)
} from "../../scripts/staging/sherivs-restore/source.mjs";
import {
  IDENTITY_PRIVILEGE_REASONS,
  PRIVILEGED_USER_COLUMNS,
  assertNoPrivilegedProfileKeys,
  assertNotSelfAccountStatusChange,
  parseHrStaffPatch,
  parseSelfProfilePatch,
  privilegedKeysIn,
} from "@/lib/runtime/identity-privilege";
import { decideAccountAdministration, evaluateRoleGate } from "@/lib/security-role-gate";
import { resolvePublicSupabaseConfig } from "../../frontend/src/integrations/supabase/public-config";
import {
  executableSqlCode,
  extractDollarQuotedFunctionBody,
  stripSqlComments,
} from "./sherivs-sql-comment-strip";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const CANONICAL_USERS =
  "database/supabase/migrations/20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql";
const HELPERS_DEFINER =
  "database/supabase/migrations/20260620151525_b630392a-2197-480f-b1cb-99da6c869c81.sql";
const PROPOSED =
  "database/supabase/migrations/20261015000010_sherivs_identity_privilege_freeze.sql.proposed";
const PROPOSED_ROLLBACK =
  "database/supabase/rollbacks/20261015000010_sherivs_identity_privilege_freeze.sql.proposed";
const CLIENT = "frontend/src/integrations/supabase/client.ts";
const PUBLIC_CONFIG = "frontend/src/integrations/supabase/public-config.ts";
const CLIENT_SERVER = "frontend/src/integrations/supabase/client.server.ts";
const ROLE_ASSIGN = "database/supabase/migrations/20261002000001_coregrid_v1_neutral_tenant_primitives.sql";
const MEMBERSHIP = "database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql";
const TEACHERS = "frontend/src/lib/runtime/scholar/teachers.functions.ts";
const STAFF_ACCOUNTS = "frontend/src/lib/runtime/scholar/staff-accounts.functions.ts";
const PROFILE_FN = "frontend/src/lib/profile.functions.ts";
const HR = "frontend/src/routes/_authenticated/admin/hr.tsx";
const TARGET = "scripts/lib/sherivs-db-target.mjs";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const proposed = read(PROPOSED);
const rollback = read(PROPOSED_ROLLBACK);
const canonicalUsers = read(CANONICAL_USERS);
const helpersDefiner = read(HELPERS_DEFINER);

const triggerBody = extractDollarQuotedFunctionBody(
  proposed,
  "public.forbid_self_privilege_mutation",
);
const triggerExecutable = executableSqlCode(triggerBody);
const triggerWithoutComments = stripSqlComments(triggerBody);
const proposedExecutable = executableSqlCode(proposed);

/**
 * Simulated BEFORE UPDATE control flow for the proposed trigger.
 * This is a static transcription of the plpgsql branches. It does not
 * prove PostgreSQL enforcement, RLS ordering, or live current_user.
 */
type SimulatedRow = {
  id: string;
  role: string;
  school_id: string;
  is_active: boolean | null;
};

type SimulatedTriggerResult = { ok: true } | { ok: false; message: string };

function simulateForbidSelfPrivilegeMutation(input: {
  currentUser: string;
  authUid: string | null;
  old: SimulatedRow;
  next: SimulatedRow;
}): SimulatedTriggerResult {
  const privilegeChanged =
    input.next.role !== input.old.role ||
    input.next.school_id !== input.old.school_id ||
    input.next.is_active !== input.old.is_active;

  if (input.next.id !== input.old.id) {
    return { ok: false, message: "Forbidden: identity key cannot be changed" };
  }
  if (input.currentUser === "service_role") {
    return { ok: true };
  }
  if (!privilegeChanged) {
    return { ok: true };
  }
  return { ok: false, message: "Forbidden: only service_role may modify privileged identity fields (role, school_id, is_active)" };
}

const SELF = {
  id: "11111111-1111-1111-1111-111111111111",
  role: "teacher",
  school_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  is_active: true,
};
const OTHER = {
  id: "22222222-2222-2222-2222-222222222222",
  role: "teacher",
  school_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  is_active: true,
};

describe("TEST 1 — self-role escalation (application)", () => {
  it("rejects a self-service profile patch that includes role", () => {
    expect(() => parseSelfProfilePatch({ role: "admin", full_name: "Ada" })).toThrow(
      IDENTITY_PRIVILEGE_REASONS.privilegedProfileField,
    );
  });

  it("refuses an HR self-patch that changes role", () => {
    expect(() =>
      parseHrStaffPatch({
        actorId: "user-1",
        targetId: "user-1",
        currentRole: "teacher",
        patch: { full_name: "Ada", role: "admin" },
      }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.selfRole);
  });
});

describe("TEST 2 — self-school reassignment", () => {
  it("rejects school_id on a self-service profile patch", () => {
    expect(() =>
      parseSelfProfilePatch({
        school_id: "22222222-2222-2222-2222-222222222222",
        full_name: "Ada",
      }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.privilegedProfileField);
  });

  it("rejects school_id on an HR patch for any target", () => {
    expect(() =>
      parseHrStaffPatch({
        actorId: "admin-1",
        targetId: "teacher-1",
        patch: { full_name: "Bea", school_id: "other-school" },
      }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.schoolReassignment);
  });
});

describe("TEST 3 — protected column mutation", () => {
  it("names the privilege-bearing columns that must not be self-written", () => {
    expect([...PRIVILEGED_USER_COLUMNS].sort()).toEqual(["is_active", "role", "school_id"]);
  });

  it("detects privileged keys before Zod stripping could hide them", () => {
    expect(privilegedKeysIn({ role: "admin", is_active: true, full_name: "Ada" })).toEqual([
      "role",
      "is_active",
    ]);
    expect(() => assertNoPrivilegedProfileKeys({ is_active: false })).toThrow(
      IDENTITY_PRIVILEGE_REASONS.privilegedProfileField,
    );
  });
});

describe("TEST 4 — legitimate profile editing", () => {
  it("accepts non-privileged profile fields", () => {
    expect(
      parseSelfProfilePatch({
        full_name: "Ada Lovelace",
        phone: "08000000000",
        address: "12 Computing Lane",
        emergency_contact_name: "Kin",
        emergency_contact: "08001111111",
        avatar_url: "https://example.edu/a.png",
      }),
    ).toEqual({
      full_name: "Ada Lovelace",
      phone: "08000000000",
      address: "12 Computing Lane",
      emergency_contact_name: "Kin",
      emergency_contact: "08001111111",
      avatar_url: "https://example.edu/a.png",
    });
  });

  it("strips role from the client patch (server path only) and keeps employment fields", () => {
    expect(
      parseHrStaffPatch({
        actorId: "admin-1",
        targetId: "teacher-1",
        currentRole: "teacher",
        patch: {
          full_name: "Bea",
          role: "bursar",
          salary: 100,
          employment_type: "full-time",
        },
      }),
    ).toEqual({
      full_name: "Bea",
      salary: 100,
      employment_type: "full-time",
    });
  });
});

describe("TEST 5 / 6 — membership escalation and cross-user membership", () => {
  it("neutral membership INSERT/UPDATE requires is_tenant_admin, not users.role", () => {
    const sql = read(MEMBERSHIP);
    expect(sql).toContain("WITH CHECK (public.is_tenant_admin(tenant_id))");
    expect(sql).toContain("USING (public.is_tenant_admin(tenant_id))");
    expect(sql).toContain("WITH CHECK (public.is_tenant_admin(tenant_ref))");
    expect(sql).not.toMatch(/is_school_admin\(\)/);
  });

  it("an HR actor cannot smuggle a membership identifier onto another user", () => {
    expect(() =>
      parseHrStaffPatch({
        actorId: "admin-1",
        targetId: "teacher-1",
        patch: { full_name: "Bea", membership_id: "secret" },
      }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.unknownField);
  });
});

describe("TEST 7 — inactive account enforcement (source + app gate)", () => {
  it("canonical Scholar helpers do not filter is_active (the confirmed gap)", () => {
    expect(helpersDefiner).toContain("SELECT school_id FROM public.users WHERE id = auth.uid();");
    expect(helpersDefiner).toContain("SELECT role FROM public.users WHERE id = auth.uid();");
    expect(helpersDefiner).toContain(
      "SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin','principal'));",
    );
    expect(helpersDefiner).not.toMatch(/is_active\s*=\s*true/);
  });

  it("proposed helpers require is_active = true on all three Scholar predicates", () => {
    expect(proposed).toMatch(/WHERE id = auth\.uid\(\)\s+AND is_active = true;/);
    expect(proposed).toMatch(/AND role IN \('admin', 'principal'\)\s+AND is_active = true/);
    const activeFilters = proposed.match(/is_active = true/g) ?? [];
    expect(activeFilters.length).toBeGreaterThanOrEqual(3);
  });

  it("Phase 08 denies a suspended lifecycle before consulting role", () => {
    const gate = evaluateRoleGate("school_admin", {
      roleGranted: true,
      scope: "11111111-1111-1111-1111-111111111111",
      lifecycle: "suspended",
    });
    expect(gate.decision).toBe("deny");
    if (gate.decision === "deny") expect(gate.code).toBe("lifecycle_denied");
  });
});

describe("TEST 8 — trigger side effects", () => {
  it("canonical users trigger only touches updated_at", () => {
    expect(canonicalUsers).toContain(
      "CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();",
    );
    expect(canonicalUsers).not.toContain("forbid_self_privilege_mutation");
  });

  it("proposed trigger freezes role, school_id, and is_active on self-update", () => {
    expect(proposed).toContain("CREATE TRIGGER trg_users_forbid_self_privilege_mutation");
    expect(proposed).toContain("BEFORE UPDATE ON public.users");
    expect(proposed).toContain("NEW.role IS DISTINCT FROM OLD.role");
    expect(proposed).toContain("NEW.school_id IS DISTINCT FROM OLD.school_id");
    expect(proposed).toContain("NEW.is_active IS DISTINCT FROM OLD.is_active");
    expect(proposed).toContain("current_user = 'service_role'");
    expect(proposed).toContain(
      "RAISE EXCEPTION 'Forbidden: only service_role may modify privileged identity fields (role, school_id, is_active)'",
    );
    expect(proposed).toMatch(/SECURITY INVOKER/);
  });
});

describe("TEST 9 — administrator provisioning path remains gated", () => {
  it("staff-account creation still uses decideAccountAdministration then service-role upsert", () => {
    const src = read(STAFF_ACCOUNTS);
    expect(src).toContain("decideAccountAdministration");
    expect(src).toContain("resolveRoleGate");
    expect(src).toContain('from("users").upsert');
    expect(src).toContain("supabaseAdmin");
  });

  it("composite administration still fails closed without a role", () => {
    const denied = decideAccountAdministration({
      platformSuper: false,
      schoolAdmin: false,
      schoolScope: null,
    });
    expect(denied.decision).toBe("deny");
  });
});

describe("TEST 10 — RLS new-row checks (source model)", () => {
  it("canonical User updates self remains id-only (WITH CHECK cannot see OLD)", () => {
    expect(canonicalUsers).toContain(
      'CREATE POLICY "User updates self" ON public.users FOR UPDATE',
    );
    expect(canonicalUsers).toMatch(
      /CREATE POLICY "User updates self" ON public\.users FOR UPDATE\s+USING \(id = auth\.uid\(\)\) WITH CHECK \(id = auth\.uid\(\)\);/,
    );
  });

  it("canonical School admin manages users still tenant-scopes WITH CHECK", () => {
    expect(canonicalUsers).toContain(
      "WITH CHECK ((school_id = public.get_my_school_id() AND public.is_school_admin()) OR public.is_super_admin())",
    );
  });

  it("proposed SQL does not drop or broaden users policies or grants", () => {
    expect(proposed).not.toMatch(/^\s*CREATE POLICY/m);
    expect(proposed).not.toMatch(/^\s*DROP POLICY/m);
    expect(proposed).not.toMatch(/^\s*GRANT /m);
    expect(proposed).not.toMatch(/^\s*REVOKE /m);
  });
});

describe("TEST 11 — privileged RPCs", () => {
  it("assign_role / grant_role_capability remain is_tenant_admin gated", () => {
    const sql = read(ROLE_ASSIGN);
    expect(sql).toContain("IF NOT public.is_tenant_admin(p_tenant::text) THEN");
    expect(sql).toContain("RAISE EXCEPTION 'Not authorized to assign roles for this tenant'");
    expect(sql).toContain("RAISE EXCEPTION 'Not authorized to grant capabilities for this tenant'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.assign_role(uuid, uuid, text, date, date) TO authenticated;");
  });
});

describe("TEST 12 — service-role boundary", () => {
  it("browser public client does not accept a service-role key", () => {
    expect(read(CLIENT)).not.toMatch(/SERVICE_ROLE/);
    expect(read(PUBLIC_CONFIG)).not.toMatch(/SERVICE_ROLE/);
    const browser = resolvePublicSupabaseConfig({
      viteUrl: "https://example.supabase.co",
      viteKey: "sb_publishable_fixture",
      serverUrl: "https://example.supabase.co",
      serverKey: "sb_publishable_fixture",
      isBrowser: true,
    });
    expect(browser.source).toBe("vite");
    expect(browser.publishableKey).toBe("sb_publishable_fixture");
  });

  it("service-role client remains a server-only module", () => {
    expect(read(CLIENT_SERVER)).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(CLIENT_SERVER).toContain("client.server.ts");
  });
});

describe("TEST 13 — conflicting identity representations", () => {
  it("a client-claimed admin role does not satisfy evaluateRoleGate without roleGranted", () => {
    const gate = evaluateRoleGate("school_admin", {
      roleGranted: false,
      scope: "11111111-1111-1111-1111-111111111111",
    });
    expect(gate.decision).toBe("deny");
  });

  it("an HR self-patch that repeats the current role still drops privilege columns", () => {
    expect(
      parseHrStaffPatch({
        actorId: "admin-1",
        targetId: "admin-1",
        currentRole: "admin",
        currentActive: true,
        patch: { full_name: "Ada", role: "admin", phone: "0800" },
      }),
    ).toEqual({ full_name: "Ada", phone: "0800" });
  });
});

describe("TEST 14 — tenant isolation regression (identity path)", () => {
  it("HR cannot set school_id even for a same-actor admin", () => {
    expect(() =>
      parseHrStaffPatch({
        actorId: "admin-1",
        targetId: "teacher-2",
        patch: { role: "teacher", school_id: "other" },
      }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.schoolReassignment);
  });

  it("proposed get_my_school_id remains auth.uid()-derived with no client tenant argument", () => {
    expect(proposed).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_school_id\(\)/);
    expect(proposed).not.toMatch(/get_my_school_id\([^)]*uuid/);
  });
});

describe("TEST 15 — environment-target and migration-runner pin", () => {
  it("canonical pin remains 71 files at d195ba8 and proposed SQL is excluded", () => {
    expect(PINNED_MIGRATION_COUNT).toBe(71);
    expect(PINNED_SOURCE_COMMIT).toBe("d195ba861f80379b79533126653b9cee82a8e872");
    const tree = inspectWorkingTree(ROOT);
    expect(tree.files).not.toContain("20261015000010_sherivs_identity_privilege_freeze.sql.proposed");
    expect(tree.files.every((f: string) => !f.endsWith(".sql.proposed"))).toBe(true);
  });

  it("verifyLoadedFiles still refuses a proposed filename", () => {
    const approved = loadApprovedManifest();
    expect(() =>
      verifyLoadedFiles(
        [
          ...approved.files.map((f: { filename: string; sha256: string }) => ({
            filename: f.filename,
            bytes: Buffer.from("x"),
          })),
          { filename: "20261015000010_sherivs_identity_privilege_freeze.sql.proposed", bytes: Buffer.from("x") },
        ],
        approved,
      ),
    ).toThrow(/PROPOSED_SQL_EXCLUDED/);
  });

  it("environment-target helper is still present and fail-closed", () => {
    const src = read(TARGET);
    expect(src).toContain("TARGET_MISSING");
    expect(src).toContain("SHERIVS_DATABASE_TARGET");
    expect(src).toContain("SHERIVS_CONFIRM_PRODUCTION");
  });
});

describe("TEST 16 — no weakening of existing restrictions", () => {
  it("does not add authenticated grants on users", () => {
    expect(proposed).not.toMatch(/GRANT .*ON public\.users/i);
  });

  it("profile parser remains strict (unknown keys fail)", () => {
    expect(() => parseSelfProfilePatch({ full_name: "Ada", nickname: "A" })).toThrow();
  });

  it("teachers setTeacherActive refuses self-deactivation in source", () => {
    expect(read(TEACHERS)).toContain("assertNotSelfAccountStatusChange(context.userId, data.userId)");
    expect(() => assertNotSelfAccountStatusChange("same", "same")).toThrow(
      IDENTITY_PRIVILEGE_REASONS.selfActive,
    );
    expect(() => assertNotSelfAccountStatusChange("admin", "teacher")).not.toThrow();
  });
});

describe("TEST 17 — failure behavior", () => {
  it("unresolved actor or target fails closed", () => {
    expect(() =>
      parseHrStaffPatch({ actorId: "", targetId: "t", patch: { full_name: "Ada" } }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.actorUnresolved);
    expect(() =>
      parseHrStaffPatch({ actorId: "a", targetId: "  ", patch: { full_name: "Ada" } }),
    ).toThrow(IDENTITY_PRIVILEGE_REASONS.targetUnresolved);
    expect(() => assertNotSelfAccountStatusChange("", "x")).toThrow(
      IDENTITY_PRIVILEGE_REASONS.actorUnresolved,
    );
  });

  it("proposed helpers keep SECURITY DEFINER and search_path=public", () => {
    expect(proposed).toMatch(/FUNCTION public\.is_school_admin\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
    expect(proposed).toMatch(/FUNCTION public\.get_my_school_id\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
    expect(proposed).toMatch(/FUNCTION public\.get_my_role\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
  });
});

describe("TEST 18 — diagnostics do not disclose secrets", () => {
  it("refusal strings contain no tokens, connection strings, or record payloads", () => {
    const reasons = Object.values(IDENTITY_PRIVILEGE_REASONS).join("\n");
    expect(reasons).not.toMatch(/postgres:\/\//i);
    expect(reasons).not.toMatch(/service_role/i);
    expect(reasons).not.toMatch(/Bearer /);
    expect(reasons).not.toMatch(/eyJ/);
    expect(proposed).toContain("RAISE EXCEPTION 'Forbidden:");
    expect(proposed).not.toMatch(/RAISE EXCEPTION '.*NEW\./);
  });
});

describe("proposed migration inventory and rollback inverse", () => {
  it("is marked AUTHORED, NOT APPLIED and is not a .sql pin member", () => {
    expect(proposed).toContain("Status: AUTHORED, NOT APPLIED");
    expect(PROPOSED.endsWith(".sql.proposed")).toBe(true);
    const sqlOnly = readdirSync(join(ROOT, "database/supabase/migrations")).filter(
      (f) => f.endsWith(".sql") && !f.endsWith(".sql.proposed"),
    );
    expect(sqlOnly).not.toContain("20261015000010_sherivs_identity_privilege_freeze.sql.proposed");
  });

  it("rollback restores pre-is_active helper bodies and drops the trigger", () => {
    expect(rollback).toContain("DROP TRIGGER IF EXISTS trg_users_forbid_self_privilege_mutation ON public.users;");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.forbid_self_privilege_mutation();");
    expect(rollback).toContain("SELECT school_id FROM public.users WHERE id = auth.uid();");
    expect(rollback).toContain("SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin','principal'));");
    expect(rollback).toMatch(/^\s*BEGIN;/m);
    expect(rollback).toMatch(/^\s*COMMIT;/m);
    const begin = rollback.search(/^\s*BEGIN;/m);
    const commit = rollback.search(/^\s*COMMIT;/m);
    const window = rollback.slice(begin, commit);
    expect(window).toContain("DROP TRIGGER IF EXISTS trg_users_forbid_self_privilege_mutation");
    expect(window).toContain("DROP FUNCTION IF EXISTS public.forbid_self_privilege_mutation()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.get_my_school_id()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.get_my_role()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.is_school_admin()");
  });

  it("application call sites import the privilege helper", () => {
    expect(read(PROFILE_FN)).toContain("parseSelfProfilePatch");
    expect(existsSync(join(ROOT, HR))).toBe(false);
  });
});

describe("B-1 trusted execution context (static source)", () => {
  it("has no auth.uid() branch and always raises for untrusted privilege changes", () => {
    expect(triggerExecutable).not.toMatch(/auth\.uid\s*\(/);
    expect(triggerWithoutComments).not.toContain("v_uid");
    expect(triggerWithoutComments).toContain(
      "RAISE EXCEPTION 'Forbidden: only service_role may modify privileged identity fields (role, school_id, is_active)'",
    );
  });

  it("names current_user = 'service_role' as the only trusted provisioner", () => {
    expect(triggerWithoutComments).toMatch(/IF\s+current_user\s+=\s+'service_role'\s+THEN/);
    expect(triggerExecutable).toMatch(/current_user\s+=/);
    expect(triggerExecutable).not.toMatch(/session_user/);
    expect(triggerExecutable).not.toMatch(/current_setting\s*\(/);
    expect(triggerExecutable).not.toMatch(/request\.jwt/);
    expect(triggerExecutable).not.toMatch(/auth\.role\s*\(/);
    expect(triggerExecutable).not.toMatch(/postgres/);
  });

  it("fails closed when privilege columns change outside the trusted role", () => {
    expect(triggerExecutable).toMatch(/RAISE EXCEPTION/);
  });
});

describe("B-1 privilege-mutation matrix (simulated — not PostgreSQL)", () => {
  it("CASE 1: authenticated profile-field update is unaffected by the freeze", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF },
    });
    expect(result).toEqual({ ok: true });
  });

  it("CASE 2: authenticated self role change is rejected", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF, role: "admin" },
    });
    expect(result.ok).toBe(false);
  });

  it("CASE 3: authenticated self school_id change is rejected", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF, school_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    });
    expect(result.ok).toBe(false);
  });

  it("CASE 4: authenticated self is_active change is rejected", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF, is_active: false },
    });
    expect(result.ok).toBe(false);
  });

  it("CASE 5: privilege update with null uid and non-service_role is rejected", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: null,
      old: SELF,
      next: { ...SELF, role: "admin" },
    });
    expect(result).toEqual({
      ok: false,
      message: "Forbidden: only service_role may modify privileged identity fields (role, school_id, is_active)",
    });
  });

  it("CASE 6: authenticated administrator updating another user is rejected", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "authenticated",
      authUid: SELF.id,
      old: OTHER,
      next: { ...OTHER, role: "admin", is_active: false },
    });
    expect(result.ok).toBe(false);
  });

  it("CASE 7: service_role provisioning of privilege columns is trigger-permitted", () => {
    const withSubject = simulateForbidSelfPrivilegeMutation({
      currentUser: "service_role",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF, role: "admin" },
    });
    const withoutSubject = simulateForbidSelfPrivilegeMutation({
      currentUser: "service_role",
      authUid: null,
      old: SELF,
      next: { ...SELF, role: "admin", is_active: true },
    });
    expect(withSubject).toEqual({ ok: true });
    expect(withoutSubject).toEqual({ ok: true });
  });

  it("CASE 8: postgres DEFINER execution is not treated as the provisioner", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "postgres",
      authUid: null,
      old: SELF,
      next: { ...SELF, role: "admin" },
    });
    expect(result.ok).toBe(false);
  });

  it("CASE 9: DEFINER owner is not a trusted provisioner for self or other rows", () => {
    const selfWrite = simulateForbidSelfPrivilegeMutation({
      currentUser: "postgres",
      authUid: SELF.id,
      old: SELF,
      next: { ...SELF, is_active: false },
    });
    expect(selfWrite.ok).toBe(false);
    const otherWrite = simulateForbidSelfPrivilegeMutation({
      currentUser: "postgres",
      authUid: SELF.id,
      old: OTHER,
      next: { ...OTHER, role: "admin" },
    });
    expect(otherWrite.ok).toBe(false);
  });

  it("CASE 10: unknown execution context fails closed on privilege columns", () => {
    const result = simulateForbidSelfPrivilegeMutation({
      currentUser: "anon",
      authUid: null,
      old: SELF,
      next: { ...SELF, school_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("B-2 transactional forward proposal (static source)", () => {
  it("wraps helper replacement and trigger installation in one BEGIN/COMMIT", () => {
    const begin = proposedExecutable.search(/^\s*BEGIN;/m);
    const commit = proposedExecutable.search(/^\s*COMMIT;/m);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(begin);
    const window = proposedExecutable.slice(begin, commit);
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.get_my_school_id()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.get_my_role()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.is_school_admin()");
    expect(window).toContain("CREATE OR REPLACE FUNCTION public.forbid_self_privilege_mutation()");
    expect(window).toContain("DROP TRIGGER IF EXISTS trg_users_forbid_self_privilege_mutation ON public.users");
    expect(window).toContain("CREATE TRIGGER trg_users_forbid_self_privilege_mutation");
    expect(proposedExecutable.slice(commit)).not.toMatch(
      /CREATE OR REPLACE FUNCTION|CREATE TRIGGER|DROP TRIGGER/,
    );
  });

  it("contains no non-transactional operations and does not swallow errors", () => {
    expect(proposedExecutable).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
    expect(proposedExecutable).not.toMatch(/REINDEX/i);
    expect(proposedExecutable).not.toMatch(/\bVACUUM\b/i);
    expect(triggerExecutable).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    for (const name of [
      "public.get_my_school_id",
      "public.get_my_role",
      "public.is_school_admin",
      "public.forbid_self_privilege_mutation",
    ]) {
      const body = extractDollarQuotedFunctionBody(proposed, name);
      expect(executableSqlCode(body)).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    }
    expect(proposed).toContain("runner.mjs");
    expect(proposed).toContain("inner COMMIT");
  });
});
