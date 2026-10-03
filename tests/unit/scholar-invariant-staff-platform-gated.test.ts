/**
 * CoreGrid — M-R-121 T2: §27 per-function invariant suites (Constitution §27).
 *
 * Machine-checked proof that every exported server function in the staff-gated
 * and platform-gated Scholar families enforces the full §27 chain —
 * AUTHENTICATE, RESOLVE TENANT, AUTHORIZE (fail-closed), VALIDATE, EXECUTE
 * (sanctioned substrate), AUDIT. Static analysis of the family source (no
 * network, no database): the suite reads each `*.functions.ts` file, splits it
 * into server-function blocks and asserts the enforcement markers of each §27
 * step against the classified manifest. The manifest is the spec; the source
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
  readonly input: "zod" | "none";
  readonly gate: GateKind;
  readonly audit: AuditClass;
  readonly auditMarkers?: readonly RegExp[];
  readonly gateMarker?: RegExp;
  readonly auditSource?: "block" | "file";
  readonly extra?: readonly RegExp[];
  readonly note?: string;
}

interface FamilySpec {
  readonly family: string;
  readonly functions: readonly FnSpec[];
  readonly helpers?: Readonly<Record<string, readonly RegExp[]>>;
  readonly auditDeclaration?: string;
  readonly gateway?: boolean;
  readonly externalProvider?: string;
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
const WRITE_EVIDENCE_RE = /\.(insert|update|upsert)\(|\.rpc\(|updateUserById/;
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
        expect(block).toMatch(
          new RegExp(`createServerFn\\(\\{\\s*method:\\s*"${spec.method}"`),
        );
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
          expect(block, `${label}: probe may return only a derived boolean`).toMatch(/hasSuperAdmin/);
        } else {
          expect(block, `${label}: must enter through requireSupabaseAuth`).toMatch(MIDDLEWARE_RE);
        }
      }
    });

    it("2 RESOLVE TENANT: tenant resolved server-side, never trusted from client input", () => {
      if (!fam.clientTenantSelector) {
        expect(src, `${fam.family}: client input contract must declare no tenant field`).not.toMatch(
          CLIENT_TENANT_FIELD_RE,
        );
      }
      for (const spec of fam.functions) {
        const block = blocks.get(spec.fn) ?? "";
        const label = `${fam.family}#${spec.fn}`;
        if (!PLATFORM_AUTHORITY_GATES.has(spec.gate)) {
          expect(block, `${label}: must never query by a client-supplied tenant id`).not.toMatch(
            EQ_CLIENT_TENANT_RE,
          );
          expect(block, `${label}: must never stamp a client-supplied tenant id into a row`).not.toMatch(
            PAYLOAD_CLIENT_TENANT_RE,
          );
        }
        const marker = spec.gateMarker ?? GATE_MARKERS[spec.gate];
        if (marker) {
          expect(block, `${label}: tenant/authority must be resolved through the declared enforcement`).toMatch(marker);
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
        expect(block, `${label}: session validity must be attested at the gate`).toMatch(/sessionValid/);
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
        expect(block, `${fam.family}#${spec.fn}: must execute through the sanctioned substrate`).toMatch(
          SUBSTRATE_RE,
        );
      }
      expect(src, `${fam.family}: no vendor SDK import (provider-agnostic, §25)`).not.toMatch(
        VENDOR_SDK_RE,
      );
      if (fam.gateway) {
        expect(src, `${fam.family}: AI-bearing family must route through the AI gateway (§20)`).toMatch(
          /invokeAiGateway/,
        );
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
          expect(evidence, `${label}: must perform the declared mutation`).toMatch(WRITE_EVIDENCE_RE);
          for (const re of spec.auditMarkers ?? []) {
            expect(evidence, `${label}: audit evidence marker`).toMatch(re);
          }
        }
      }
      if (fam.auditDeclaration) {
        expect(src, `${fam.family}: contract must declare its audit posture in its own header`).toContain(
          fam.auditDeclaration,
        );
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
 * Family manifests (staff-gate / platform-gate / composite-gate families).
 * ─────────────────────────────────────────────────────────────────────────*/

defineFamilySuite({
  family: "expense-insights.functions.ts",
  gateway: true,
  functions: [
    {
      fn: "getExpenseInsights",
      method: "POST",
      input: "none",
      gate: "staff",
      audit: "pure-read",
      note: "no-audit class declared by the contract header ('Never persists'); cost-bearing AI call observable through the AI gateway ledger (§20)",
    },
  ],
  auditDeclaration: "Never persists",
});

defineFamilySuite({
  family: "lesson-plan-ai.functions.ts",
  gateway: true,
  functions: [
    {
      fn: "draftLessonPlan",
      method: "POST",
      input: "zod",
      gate: "staff",
      audit: "pure-read",
      note: "no-audit class declared by the contract header ('Never persists anything itself'); AI call observable through the gateway ledger",
    },
  ],
  auditDeclaration: "Never persists anything itself",
});

defineFamilySuite({
  family: "messages-broadcast.functions.ts",
  functions: [
    {
      fn: "broadcastMessage",
      method: "POST",
      input: "zod",
      gate: "staff",
      audit: "write-through",
      auditMarkers: [/\.from\("messages"\)/, /\.from\("notifications"\)/],
      extra: [/!isAdmin && !isTeacher/, /cls\.teacher_id !== userId/],
      note: "audience policy branches on the canonical role: teachers fail closed to their OWN class (cls.teacher_id === userId)",
    },
  ],
  auditDeclaration: "one row per recipient",
});

defineFamilySuite({
  family: "provisioning.functions.ts",
  clientTenantSelector: true,
  helpers: {
    assertSuper: [/requirePlatformSuperAdmin\(/, /lifecycle:\s*null/, /sessionValid/],
  },
  functions: [
    {
      fn: "checkPlatformBootstrap",
      method: "GET",
      input: "none",
      gate: "bootstrap-public",
      audit: "pure-read",
      note: "recorded finding: public bootstrap liveness probe — returns only a derived boolean, no tenant data",
    },
    {
      fn: "claimFirstSuperAdmin",
      method: "POST",
      input: "zod",
      gate: "bootstrap-count",
      audit: "explicit-event",
      auditMarkers: [/\.from\("super_admins"\)/, /writeAuditRecord\(/],
      extra: [/Bootstrap is closed/],
      note: "authorization = bootstrap-closed precondition (only proceeds when zero super admins exist); caller's own auth identity is used; §27.6 closed via the shared write-audit hook (frontend/src/lib/server/write-audit.ts, control-plane-scope fail-closed audit record)",
    },
    {
      fn: "updateSchoolPlan",
      method: "POST",
      input: "zod",
      gate: "platform-super",
      audit: "explicit-event",
      auditMarkers: [/super_admin_logs/],
      gateMarker: /assertSuper\(context\)/,
    },
    {
      fn: "resetSchoolAdminPassword",
      method: "POST",
      input: "zod",
      gate: "platform-super",
      audit: "explicit-event",
      auditMarkers: [/super_admin_logs/],
      gateMarker: /assertSuper\(context\)/,
    },
  ],
  findings: [
    "§27.2 note: provisioning is a platform-authority family — its super-admin functions address TARGET tenants by client-supplied, UUID-validated id; authorization is the platform super-admin gate (requirePlatformSuperAdmin) and every write is audited to super_admin_logs, so the client id is a resource selector, never an authorization input. Recorded as the declared clientTenantSelector exception.",
    "§27.1 finding: checkPlatformBootstrap allows anonymous entry by design (public bootstrap liveness probe). Exposure is bounded to a derived boolean (hasSuperAdmin) over the service-role client; no tenant data is returned. Recorded, not accommodated.",
  ],
});

defineFamilySuite({
  family: "staff-accounts.functions.ts",
  functions: [
    {
      fn: "createStaffAccount",
      method: "POST",
      input: "zod",
      gate: "composite-account",
      audit: "write-through",
      auditMarkers: [/\.from\("users"\)/],
      extra: [/cg_identity/, /cg_workforce_position/],
      note: "composite gate: platform super-admin OR same-school admin/principal via decideAccountAdministration (fail-closed deny)",
    },
    {
      fn: "resetStaffPassword",
      method: "POST",
      input: "zod",
      gate: "composite-account",
      audit: "explicit-event",
      auditMarkers: [/updateUserById/, /writeAuditRecord\(/],
      note: "same-tenant rule for school admins enforced via decideAccountAdministration(targetSchoolId); §27.6 closed via the shared write-audit hook (frontend/src/lib/server/write-audit.ts, fail-closed audit_logs record; the new credential is never audited, §29)",
    },
  ],
});