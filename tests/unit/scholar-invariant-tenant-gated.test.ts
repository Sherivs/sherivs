/**
 * Sherivs — M-R-121 T2: §27 per-function invariant suites (Constitution §27).
 *
 * Machine-checked proof that every exported server function in the tenant-gated
 * Scholar families enforces the full §27 chain — AUTHENTICATE, RESOLVE TENANT,
 * AUTHORIZE (fail-closed), VALIDATE, EXECUTE (sanctioned substrate), AUDIT —
 * rather than claiming it. Static analysis of the family source (no network,
 * no database): the suite reads each `*.functions.ts` file, splits it into
 * server-function blocks and asserts the enforcement markers of each §27 step
 * against the classified manifest below. The manifest is the spec; the source
 * must match it. A §27 gap is never accommodated — it is recorded as a finding.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCHOLAR_DIR = join(ROOT, "frontend/src/lib/runtime/scholar");

type GateKind =
  | "school-admin"
  | "staff"
  | "platform-super"
  | "composite-account"
  | "self-scope-driver"
  | "self-scope-rpc"
  | "rls-scoped"
  | "bootstrap-count"
  | "environment"
  | "bootstrap-public";

type AuditClass = "explicit-event" | "write-through" | "pure-read";

interface FnSpec {
  readonly fn: string;
  readonly method: "GET" | "POST";
  /** "zod" = client-facing input passes .validator(); "none" = handler consumes no client data. */
  readonly input: "zod" | "none";
  readonly gate: GateKind;
  readonly audit: AuditClass;
  /** Required evidence markers for explicit-event / write-through functions. */
  readonly auditMarkers?: readonly RegExp[];
  /** Override when the gate is invoked through a declared file-local helper. */
  readonly gateMarker?: RegExp;
  /** Audit evidence asserted against the whole file (helper-carried audit). */
  readonly auditSource?: "block" | "file";
  readonly extra?: readonly RegExp[];
  readonly note?: string;
}

interface FamilySpec {
  readonly family: string;
  readonly functions: readonly FnSpec[];
  /** File-local helpers that must carry the gate + lifecycle/session signals. */
  readonly helpers?: Readonly<Record<string, readonly RegExp[]>>;
  /** The family's own header declaration of its audit posture (cited, asserted). */
  readonly auditDeclaration?: string;
  readonly gateway?: boolean;
  readonly externalProvider?: string;
  /** Recorded §27 findings — never silently deleted, never weakened into a pass. */
  readonly findings?: readonly string[];
  /** True only for platform-authority families whose validated input may address a target tenant id. */
  readonly clientTenantSelector?: boolean;
}

const GATE_MARKERS: Readonly<Record<GateKind, RegExp | null>> = {
  "school-admin": /requireSchoolAdminScope\(/,
  staff: /requireStaffContext\(/,
  "platform-super": /requirePlatformSuperAdmin\(/,
  "composite-account": /resolveRoleGate\(/,
  "self-scope-driver": /\.eq\("driver_id", userId\)/,
  "self-scope-rpc": /\.rpc\(\s*"get_my_(school_id|role|primary_workforce_position)"/,
  "rls-scoped": /\.from\("fees"\)/,
  "bootstrap-count": /super_admins/,
  environment: /ALLOW_DEMO_PROVISIONING/,
  "bootstrap-public": null,
};

/** Gates whose call sites must thread lifecycle: null + sessionValid (fail-closed contract). */
const SESSION_GATED: ReadonlySet<GateKind> = new Set([
  "school-admin",
  "staff",
  "platform-super",
  "composite-account",
]);

const PLATFORM_AUTHORITY_GATES: ReadonlySet<GateKind> = new Set([
  "platform-super",
  "bootstrap-count",
  "bootstrap-public",
  "environment",
]);

const MIDDLEWARE_RE = /\.middleware\(\[\s*requireSupabaseAuth\s*\]\)/;
/** Trust violations: querying or stamping a row BY a client-supplied tenant id. */
const EQ_CLIENT_TENANT_RE = /\.eq\("(?:school_id|tenant_id)"\s*,\s*data\./;
const PAYLOAD_CLIENT_TENANT_RE =
  /\b(?:school_id|tenant_id|schoolId|tenantId):\s*data\.(?:school_id|schoolId|tenantId|tenant_id)\b/;
/** A client input contract that declares a tenant field (except platform tenant selectors). */
const CLIENT_TENANT_FIELD_RE = /(?:school_id|schoolId|tenant_id|tenantId):\s*z\./;
const HANDLER_DATA_RE = /\.handler\(\s*(?:async\s+)?\(\s*\{\s*data\b/;
const SUBSTRATE_RE = /\bsupabase\b|\.rpc\(|supabaseAdmin|asKernelAdmin/;
const MUTATION_RE = /\.(insert|update|upsert)\(/;
const WRITE_EVIDENCE_RE =
  /\.(insert|update|upsert)\(|\.rpc\(|updateUserById|performStaffPrivilegeChange\(/;
const VENDOR_SDK_RE = /from ["'](@supabase\/supabase-js|twilio|paystack)["']/;

function serverFnBlocks(src: string): Map<string, string> {
  const marks: { name: string; start: number }[] = [];
  for (const m of src.matchAll(/export const (\w+) = createServerFn/g)) {
    marks.push({ name: m[1], start: m.index });
  }
  const blocks = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length;
    blocks.set(marks[i].name, src.slice(marks[i].start, end));
  }
  return blocks;
}

function defineFamilySuite(fam: FamilySpec): void {
  describe(`§27 server-function invariants — ${fam.family}`, () => {
    const src = readFileSync(join(SCHOLAR_DIR, fam.family), "utf8");
    const blocks = serverFnBlocks(src);

    it("inventory: every exported server function is classified and none is unlisted", () => {
      expect(
        blocks.size,
        `${fam.family}: classified server functions must equal exported ones`,
      ).toBe(fam.functions.length);
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn);
        expect(block, `${fam.family}#${spec.fn} block present`).toBeDefined();
        expect(block).toMatch(new RegExp(`createServerFn\\(\\{\\s*method:\\s*"${spec.method}"`));
      }
    });

    it("1 AUTHENTICATE: no anonymous entry — requireSupabaseAuth middleware or declared exempt gate", () => {
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn) ?? "";
        const label = `${fam.family}#${spec.fn}`;
        if (spec.gate === "environment") {
          expect(block, `${label}: environment gate must throw unless explicitly enabled`).toMatch(
            /ALLOW_DEMO_PROVISIONING\s*!==\s*["']true["']/,
          );
        } else if (spec.gate === "bootstrap-public") {
          expect(spec.method, `${label}: public bootstrap probe must stay a read-only GET`).toBe(
            "GET",
          );
          expect(block, `${label}: probe may return only a derived boolean`).toMatch(
            /hasSuperAdmin/,
          );
        } else {
          expect(block, `${label}: must enter through requireSupabaseAuth`).toMatch(MIDDLEWARE_RE);
        }
      }
    });

    it("2 RESOLVE TENANT: tenant resolved server-side, never trusted from client input", () => {
      if (!fam.clientTenantSelector) {
        expect(
          src,
          `${fam.family}: client input contract must declare no tenant field`,
        ).not.toMatch(CLIENT_TENANT_FIELD_RE);
      }
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn) ?? "";
        const label = `${fam.family}#${spec.fn}`;
        if (!PLATFORM_AUTHORITY_GATES.has(spec.gate)) {
          expect(block, `${label}: must never query by a client-supplied tenant id`).not.toMatch(
            EQ_CLIENT_TENANT_RE,
          );
          expect(
            block,
            `${label}: must never stamp a client-supplied tenant id into a row`,
          ).not.toMatch(PAYLOAD_CLIENT_TENANT_RE);
        }
        const marker = spec.gateMarker ?? GATE_MARKERS[spec.gate];
        if (marker) {
          expect(
            block,
            `${label}: tenant/authority must be resolved through the declared enforcement`,
          ).toMatch(marker);
        }
      }
    });

    it("3 AUTHORIZE: canonical gate invoked fail-closed with lifecycle/session signals", () => {
      for (const [name, markers] of Object.entries(fam.helpers ?? {})) {
        for (const re of markers) {
          expect(src, `${fam.family}: helper ${name} must carry the gate signals`).toMatch(re);
        }
      }
      for (const spec of fam.functions) {
        const label = `${fam.family}#${spec.fn}`;
        if (spec.gate === "composite-account") {
          const block = blocks.get(spec.fn) ?? "";
          expect(block, `${label}: composite decision must be evaluated fail-closed`).toMatch(
            /decideAccountAdministration\(/,
          );
        }
        if (!SESSION_GATED.has(spec.gate) || spec.gateMarker) continue;
        const block = blocks.get(spec.fn) ?? "";
        expect(block, `${label}: lifecycle signal must be threaded (never silent)`).toMatch(
          /lifecycle:\s*null/,
        );
        expect(block, `${label}: session validity must be attested at the gate`).toMatch(
          /sessionValid/,
        );
      }
    });

    it("4 VALIDATE: every client-facing input passes a contract validator (or consumes none)", () => {
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn) ?? "";
        const label = `${fam.family}#${spec.fn}`;
        if (spec.input === "zod") {
          expect(block, `${label}: must validate input through .validator(...)`).toMatch(
            /\.validator\(/,
          );
        } else {
          expect(block, `${label}: no-input handler must not consume client data`).not.toMatch(
            HANDLER_DATA_RE,
          );
        }
        if (spec.extra) {
          for (const re of spec.extra) {
            expect(block, `${label}: extra enforcement marker`).toMatch(re);
          }
        }
      }
    });

    it("5 EXECUTE: sanctioned substrate only — no vendor leakage, gateway adoption where AI-bearing", () => {
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn) ?? "";
        expect(
          block,
          `${fam.family}#${spec.fn}: must execute through the sanctioned substrate`,
        ).toMatch(SUBSTRATE_RE);
      }
      expect(src, `${fam.family}: no vendor SDK import (provider-agnostic, §25)`).not.toMatch(
        VENDOR_SDK_RE,
      );
      if (fam.gateway) {
        expect(
          src,
          `${fam.family}: AI-bearing family must route through the AI gateway (§20)`,
        ).toMatch(/invokeAiGateway/);
      }
      if (fam.externalProvider) {
        expect(
          src,
          `${fam.family}: external provider (${fam.externalProvider}) must be reached via env-configured fetch`,
        ).toMatch(/fetch\(/);
      }
    });

    it("6 AUDIT: operation leaves the declared evidence (or is the declared no-audit class)", () => {
      for (const spec of fam.functions) {
        const evidence = spec.auditSource === "file" ? src : (blocks.get(spec.fn) ?? "");
        const label = `${fam.family}#${spec.fn}`;
        if (spec.audit === "pure-read") {
          expect(evidence, `${label}: declared pure read must not mutate reality`).not.toMatch(
            MUTATION_RE,
          );
        } else {
          expect(
            (spec.auditMarkers ?? []).length,
            `${label}: ${spec.audit} must declare its evidence markers`,
          ).toBeGreaterThan(0);
          expect(evidence, `${label}: must perform the declared mutation`).toMatch(
            WRITE_EVIDENCE_RE,
          );
          for (const re of spec.auditMarkers ?? []) {
            expect(evidence, `${label}: audit evidence marker`).toMatch(re);
          }
        }
      }
      if (fam.auditDeclaration) {
        expect(
          src,
          `${fam.family}: contract must declare its audit posture in its own header`,
        ).toContain(fam.auditDeclaration);
      }
    });

    it("governance ledger: recorded §27 findings stay documented (never weakened into a pass)", () => {
      for (const finding of fam.findings ?? []) {
        expect(finding.length, "each finding must state its gap precisely").toBeGreaterThan(20);
      }
    });
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Family manifests (tenant-gated: every function resolves its tenant through
 * the canonical P08 school-admin gate).
 * ─────────────────────────────────────────────────────────────────────────*/

defineFamilySuite({
  family: "attendance.functions.ts",
  functions: [
    {
      fn: "generateTeacherCheckQr",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("qr_tokens"\)/],
      note: "qr_tokens row records created_by (actor-attributed issuance record)",
    },
    {
      fn: "teacherCheckWithQr",
      method: "POST",
      input: "zod",
      gate: "staff",
      audit: "write-through",
      auditMarkers: [/\.from\("attendance_logs"\)/],
      note: "attendance_logs row records teacher_id + verified sign-in/out",
    },
    {
      fn: "markClassAttendance",
      method: "POST",
      input: "zod",
      gate: "staff",
      audit: "write-through",
      auditMarkers: [/\.from\("attendance"\)/],
      note: "attendance rows carry marked_by = authenticated userId",
    },
  ],
});

defineFamilySuite({
  family: "digital-twin.functions.ts",
  gateway: false,
  externalProvider: "Twilio voice gateway (env-configured TWILIO_GATEWAY_URL)",
  functions: [
    {
      fn: "saveTwinConfig",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("digital_twin_config"\)/],
      extra: [/ConfigInput\.parse/],
      note: "JSON columns (school_knowledge/trigger_rules) validate through the versioned TwinPayloadEnvelope — no permissive untyped columns",
    },
    {
      fn: "placeTwinCall",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("digital_twin_calls"\)/],
      extra: [/fetch\(/, /TwilioCallResponse/],
      note: "every call attempt (stub/failed/queued) is persisted as a digital_twin_calls row; provider output is schema-validated before use",
    },
  ],
  findings: [
    "§27.4 finding (MH-02, 2026-10-02): CLOSED — ConfigInput previously used z.any() for school_knowledge/trigger_rules, leaving the JSON columns untyped. Both columns now validate through the versioned TwinPayloadEnvelope (validated version field, bounded JSON tree catchall, serialized-size cap) and the Twilio response passes TwilioCallResponse; strictness is pinned behaviorally by tests/unit/mh-02-validation-hardening.test.ts.",
  ],
});

defineFamilySuite({
  family: "facilities.functions.ts",
  helpers: {
    assertAdmin: [/requireSchoolAdminScope\(/, /lifecycle:\s*null/, /sessionValid/],
  },
  functions: [
    {
      fn: "upsertSchoolMeals",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditMarkers: [/\.from\("school_meals"\)/, /writeAuditRecord\(/],
      gateMarker: /assertAdmin\(context\)/,
      note: "§27.6 closed via the shared write-audit hook (frontend/src/lib/server/write-audit.ts): fail-closed audit_logs record (who/tenant/action/gate/when/outcome)",
    },
    {
      fn: "upsertSchoolTransport",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditMarkers: [/\.from\("school_transport"\)/, /writeAuditRecord\(/],
      gateMarker: /assertAdmin\(context\)/,
      note: "§27.6 closed via the shared write-audit hook: fail-closed audit_logs record (who/tenant/action/gate/when/outcome)",
    },
  ],
});

defineFamilySuite({
  family: "notification-digest.functions.ts",
  functions: [
    {
      fn: "sendNotificationDigests",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("notifications"\)/],
      note: "each digest is persisted as a notification row (the execution record)",
    },
  ],
});

defineFamilySuite({
  family: "notifications-fanout.functions.ts",
  functions: [
    {
      fn: "notifyGradesPublished",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("notifications"\)/],
    },
    {
      fn: "notifyFeesDue",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("notifications"\)/],
    },
    {
      fn: "pushNotification",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("notifications"\)/],
    },
    {
      fn: "notifyCalendarEvent",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("notifications"\)/],
    },
    {
      fn: "unlockFaceAccount",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("users"\)/],
      extra: [/target\.school_id !== schoolId/],
      note: "target account must exist inside the gate-resolved tenant before the unlock write",
    },
  ],
});

defineFamilySuite({
  family: "org-profile.functions.ts",
  functions: [
    {
      fn: "getOrganizationProfile",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "pure-read",
      note: "no-audit class: pure read over the cg_org_profile RPC; empty-object POST contract",
    },
    {
      fn: "saveOrganizationProfile",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/upsert_org_profile/],
      note: "payload re-validated by scholarSchoolProfileSchema inside the validator",
    },
  ],
});

defineFamilySuite({
  family: "school-settings.functions.ts",
  functions: [
    {
      fn: "updateSchoolSettings",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditMarkers: [/\.from\("schools"\)/, /writeAuditRecord\(/],
      note: "§27.6 closed via the shared write-audit hook (frontend/src/lib/server/write-audit.ts): fail-closed actor-attributed audit_logs record (who/tenant/action/gate/when/outcome)",
    },
  ],
});

defineFamilySuite({
  family: "staff-privilege.functions.ts",
  functions: [
    {
      fn: "updateStaffPrivilege",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditSource: "file",
      auditMarkers: [/\.from\("users"\)/, /writeAuditRecord\(/],
      note: "service_role write of users.role/is_active after the school-admin gate and pure decision; fail-closed audit in performStaffPrivilegeChange",
    },
  ],
});

defineFamilySuite({
  family: "teachers.functions.ts",
  functions: [
    {
      fn: "inviteTeacher",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditMarkers: [/\.from\("users"\)/, /writeAuditRecord\(/],
      note: "created users row (school_id = gate scope) is the canonical record; §27.6 closed via the shared write-audit hook (frontend/src/lib/server/write-audit.ts, fail-closed audit_logs record; the temp credential is never audited, §29)",
    },
    {
      fn: "setTeacherActive",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "explicit-event",
      auditMarkers: [/\.from\("users"\)/, /performStaffPrivilegeChange\(/],
      extra: [/\.eq\("role", "teacher"\)/],
      note: "teacher-only, same-school; the service_role write and fail-closed §27.6 audit are delegated to performStaffPrivilegeChange (staff-privilege.functions.ts)",
    },
  ],
});

defineFamilySuite({
  family: "timetable.functions.ts",
  gateway: true,
  functions: [
    {
      fn: "generateTimetableDraft",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "pure-read",
      note: "no-audit class: draft generation persists nothing; cost-bearing call observable through the AI gateway ledger",
    },
    {
      fn: "saveTimetable",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/\.from\("timetables"\)/, /\.from\("timetable_slots"\)/],
    },
  ],
});

defineFamilySuite({
  family: "portal-overview.functions.ts",
  helpers: {
    gateSignals: [/requireSchoolAdminScope\(/, /lifecycle:\s*null/, /sessionValid/],
  },
  functions: [
    {
      fn: "loadAuditOverview",
      method: "GET",
      input: "none",
      gate: "school-admin",
      audit: "pure-read",
      gateMarker: /requireSchoolAdminScope\(context\.supabase,\s*lifecycle\)/,
      note: "head-count reads over audit_logs scoped by the gate-resolved tenant; no write path",
    },
    {
      fn: "loadPayrollOverview",
      method: "GET",
      input: "none",
      gate: "school-admin",
      audit: "pure-read",
      gateMarker: /requireSchoolAdminScope\(context\.supabase,\s*lifecycle\)/,
      note: "reads staff_payroll for the gate-resolved tenant and current period; no write path (payroll processing is planned capability)",
    },
    {
      fn: "loadFinancialReportsOverview",
      method: "GET",
      input: "none",
      gate: "school-admin",
      audit: "pure-read",
      gateMarker: /requireSchoolAdminScope\(context\.supabase,\s*lifecycle\)/,
      note: "aggregate reads over fees and school_expenses scoped by the gate-resolved tenant; no write path",
    },
    {
      fn: "loadExtracurricularOverview",
      method: "GET",
      input: "none",
      gate: "school-admin",
      audit: "pure-read",
      gateMarker: /requireSchoolAdminScope\(context\.supabase,\s*lifecycle\)/,
      note: "reads school_sports for the gate-resolved tenant; no write path",
    },
  ],
});

defineFamilySuite({
  family: "workforce-positions.functions.ts",
  functions: [
    {
      fn: "listWorkforcePositions",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "pure-read",
      extra: [/list_workforce_positions/],
    },
    {
      fn: "assignWorkforcePosition",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/assign_workforce_position/],
      extra: [/target\.school_id !== schoolId/],
      note: "security-definer RPC records the position; target must exist inside the gate-resolved tenant",
    },
    {
      fn: "endWorkforcePosition",
      method: "POST",
      input: "zod",
      gate: "school-admin",
      audit: "write-through",
      auditMarkers: [/end_workforce_position/],
    },
    {
      fn: "getMyPrimaryWorkforcePosition",
      method: "POST",
      input: "zod",
      gate: "self-scope-rpc",
      audit: "pure-read",
      extra: [/get_my_primary_workforce_position/],
      note: "the RPC enforces identity_ref = auth.uid() inside the security-definer function",
    },
  ],
});

defineFamilySuite({
  family: "mobility-advisory.functions.ts",
  gateway: true,
  functions: [
    {
      fn: "getMobilityAdvisory",
      method: "POST",
      input: "zod",
      gate: "self-scope-rpc",
      audit: "pure-read",
      gateMarker: /\.rpc\(\s*"get_my_school_id"\)/,
      extra: [
        /rpc\(\s*"scholar_can",\s*\{\s*p_org:\s*schoolId,\s*p_perm:\s*"students\.transfer"/s,
        /rpc\(\s*"student_mobility_preview"/,
        /tokenMsRemaining\(context\.claims\.exp\)/,
      ],
      note: "tenant and permission come from authenticated server context; policy preview and gateway advice are read-only and cannot approve or apply movements",
    },
  ],
});
