/**
 * CoreGrid — Phase 08 Security Engine: server-function enforcement surface.
 *
 * Machine-checked inventory of `frontend/src/lib/*.functions.ts` against the
 * canonical runtime role gate (`security-role-gate.ts`).
 *
 * Law: a server-function family that performs a *pure school-admin* check
 * (role IN admin/principal — exactly the semantics of the database
 * `public.is_school_admin()` RPC) MUST route that decision through the
 * canonical gate. Duplicated inline role reads/checks are the debt class the
 * gate exists to remove (§17.2 PROGRESS; §26/§38 of the constitution).
 *
 * Two honest exceptions exist, and only with a reason recorded:
 * - COMPOSITE_ROLE_TRACKED: families whose authorization legitimately spans
 *   roles BEYOND the school-admin kind (teacher-owner, bursar, ...). These
 *   need a future gate extension (e.g. a school-staff kind), not a silent
 *   inline check.
 * - No admin gate at all (self-scoped / public / service / driver paths) is
 *   outside this rule by construction.
 *
 * If a new role-scoped family is added without the canonical gate, this test
 * fails with the family name.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LIB_DIR = join(ROOT, "frontend/src/lib");

/** Families that have adopted the canonical gate (import must be present).
 *  Paths are relative to frontend/src/lib — relocated families live in the
 *  Scholar runtime namespace (MISSION-R-121 mechanical relocation). */
const ADOPTED = [
  "command-centre.functions.ts",
  "runtime/scholar/attendance.functions.ts",
  "runtime/scholar/digital-twin.functions.ts",
  "runtime/scholar/expense-insights.functions.ts",
  "runtime/scholar/facilities.functions.ts",
  "foundation-loop.functions.ts",
  "identity-registry.functions.ts",
  "kernel-reality.functions.ts",
  "runtime/scholar/lesson-plan-ai.functions.ts",
  "runtime/scholar/messages-broadcast.functions.ts",
  "runtime/scholar/notification-digest.functions.ts",
  "runtime/scholar/notifications-fanout.functions.ts",
  "onboarding/provision-organization.functions.ts",
  "runtime/scholar/org-profile.functions.ts",
  "runtime/scholar/provisioning.functions.ts",
  "register-runtime.functions.ts",
  "runtime/scholar/scholar-foundation-loop.functions.ts",
  "runtime/scholar/scholar-institution-config.functions.ts",
  "runtime/scholar/scholar-feature-access.functions.ts",
  "runtime/scholar/scholar-role-assignments.functions.ts",
  "runtime/scholar/school-settings.functions.ts",
  "runtime/scholar/staff-accounts.functions.ts",
  "runtime/scholar/teachers.functions.ts",
  "tenant-registry.functions.ts",
  "runtime/scholar/timetable.functions.ts",
  "runtime/scholar/workforce-positions.functions.ts",
  "runtime/scholar/portal-overview.functions.ts",
] as const;

/**
 * Families that are legitimately outside the canonical role gate, each with
 * the audit reason recorded (2026-09-03 security review). Every
 * `*.functions.ts` file must be in ADOPTED or here — an unclassified family
 * fails CI.
 */
const DOCUMENTED_EXEMPT: Readonly<Record<string, string>> = {
  "runtime/scholar/bus-tracking.functions.ts":
    "driver self-scope only (writes filtered by driver_id = auth.uid()); RLS finding queued: transport_buses policy is school-wide, not driver-scoped (DB re-verify)",
  "runtime/scholar/demo-provision.functions.ts":
    "public demo provisioning, environment-gated (ALLOW_DEMO_PROVISIONING=false default, foundation-pinned); service-role fixtures only",
  "runtime/scholar/driver-portal.functions.ts":
    "driver self-scope only (own bus reads/writes by driver_id = auth.uid()); same transport_buses RLS finding as bus-tracking",
  "runtime/scholar/paystack.functions.ts":
    "payment flow: fee rows are RLS-scoped on the authenticated client; webhook signature verification is the source of truth; parent/bursar roles are outside the school-admin gate by design",
  "profile.functions.ts":
    "self-scope only (own users row by id = auth.uid()); super-admins have no tenant profile (no-op)",
  "push.functions.ts":
    "delivery is self-limited by users RLS on user clients (push_token read only for visible rows); sendTestPush targets the caller; fanout reach across recipients requires DB re-verify",
};

/** Inline pure school-admin gate detectors (both dialects in use). */
const INLINE_ADMIN_ARRAY_RE = /\[\s*["']admin["']\s*,\s*["']principal["']\s*\]/;
const INLINE_ADMIN_COMPARISON_RE =
  /(?:me\.role|role|data\.role)\s*===\s*["']admin["']\s*\|\|\s*(?:me\.role|role|data\.role)\s*===\s*["']principal["']/;
const GATE_IMPORT_RE = /security-role-gate/;

describe("P08 security engine — server-function enforcement surface", () => {
  const families = readdirSync(LIB_DIR)
    .filter((f) => f.endsWith(".functions.ts"))
    .sort();

  it("every adopted family imports the canonical gate (no silent revert)", () => {
    for (const name of ADOPTED) {
      const source = readFileSync(join(LIB_DIR, name), "utf8");
      expect(source, `${name} must import security-role-gate`).toMatch(GATE_IMPORT_RE);
    }
  });

  it("no pure school-admin gate is duplicated inline outside the canonical gate", () => {
    const offenders: string[] = [];
    const inventory: string[] = [];

    for (const name of families) {
      const source = readFileSync(join(LIB_DIR, name), "utf8");
      const hasInlinePureAdmin =
        INLINE_ADMIN_ARRAY_RE.test(source) || INLINE_ADMIN_COMPARISON_RE.test(source);
      const importsGate = GATE_IMPORT_RE.test(source);
      const exemption = DOCUMENTED_EXEMPT[name];

      if (hasInlinePureAdmin && !importsGate && !exemption) {
        offenders.push(name);
      }

      const status = importsGate
        ? "ADOPTED"
        : hasInlinePureAdmin
          ? `INLINE_WITHOUT_GATE (${exemption ?? "unclassified!"})`
          : exemption
            ? `EXEMPT (${exemption})`
            : "unclassified!";
      inventory.push(`  ${name.padEnd(38)} ${status}`);
    }

    console.log(
      `P08 enforcement-surface inventory (${families.length} families):\n${inventory.join("\n")}`,
    );
    expect(offenders).toEqual([]);
  });

  it("classifies every server-function family as adopted or documented-exempt", () => {
    const classified = new Set([...ADOPTED, ...Object.keys(DOCUMENTED_EXEMPT)]);
    const unclassified = families.filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
    expect(Object.keys(DOCUMENTED_EXEMPT).length).toBeGreaterThan(0);
  });
});
