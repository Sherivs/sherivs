/**
 * Sherivs — M-R-121 T2: §27 per-function invariant suites (Constitution §27).
 *
 * Part 1 — the environment-gated family (demo-provision): a public, fixture
 * provisioning function whose entire §27 posture rests on an explicit
 * environment gate (ALLOW_DEMO_PROVISIONING, default OFF in every
 * environment). The suite pins that gate and records the gap honestly.
 *
 * Part 2 — the coverage ledger: all 23 Scholar server-function families are
 * partitioned across exactly the five M-R-121 T2 §27 invariant suites, so a
 * new family cannot silently escape the invariant regime.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
 * Family manifest (environment-gated family).
 * ─────────────────────────────────────────────────────────────────────────*/

// The environment-gated family is EMPTY: demo-provision.functions.ts (the
// only member) was removed with all demo provisioning (2026-10-20). The
// suite file stays as the home of the coverage ledger below.
void defineFamilySuite;

/* ───────────────────────────────────────────────────────────────────────────
 * Part 2 — the coverage ledger: the five M-R-121 T2 suites partition the
 * 25 Scholar server-function families exhaustively.
 * ─────────────────────────────────────────────────────────────────────────*/

const SUITE_PARTITION: Readonly<Record<string, readonly string[]>> = {
  "scholar-invariant-tenant-gated.test.ts": [
    "attendance.functions.ts",
    "digital-twin.functions.ts",
    "facilities.functions.ts",
    "notification-digest.functions.ts",
    "notifications-fanout.functions.ts",
    "org-profile.functions.ts",
    "portal-overview.functions.ts",
    "school-settings.functions.ts",
    "staff-privilege.functions.ts",
    "teachers.functions.ts",
    "timetable.functions.ts",
    "workforce-positions.functions.ts",
  ],
  "scholar-invariant-staff-platform-gated.test.ts": [
    "expense-insights.functions.ts",
    "lesson-plan-ai.functions.ts",
    "messages-broadcast.functions.ts",
    "provisioning.functions.ts",
    "staff-accounts.functions.ts",
  ],
  "scholar-invariant-kernel-substrate.test.ts": [
    "scholar-foundation-loop.functions.ts",
    "scholar-institution-config.functions.ts",
    "scholar-role-assignments.functions.ts",
    "scholar-feature-access.functions.ts",
  ],
  "scholar-invariant-self-scope.test.ts": [
    "bus-tracking.functions.ts",
    "driver-portal.functions.ts",
    "paystack.functions.ts",
    "wallet-topup.functions.ts",
  ],
  "scholar-invariant-environment-gated.test.ts": [],
};

describe("§27 invariant coverage ledger — Scholar server-function families", () => {
  const onDisk = readdirSync(SCHOLAR_DIR)
    .filter((f) => f.endsWith(".functions.ts"))
    .sort();

  it("all 25 families exist on disk and are partitioned exactly once across the five suites", () => {
    expect(onDisk).toHaveLength(25);
    const covered = Object.values(SUITE_PARTITION).flat();
    expect(covered).toHaveLength(25);
    expect(new Set(covered).size, "no family may be covered twice").toBe(25);
    expect([...covered].sort()).toEqual(onDisk);
    for (const suite of Object.keys(SUITE_PARTITION)) {
      expect(() => readFileSync(join(ROOT, "tests/unit", suite), "utf8"), suite).not.toThrow();
    }
  });

  it("every family authenticates through requireSupabaseAuth", () => {
    for (const family of onDisk) {
      const src = readFileSync(join(SCHOLAR_DIR, family), "utf8");
      expect(src, `${family}: must import the auth middleware`).toMatch(/requireSupabaseAuth/);
    }
  });

  it("no family imports a vendor SDK directly (provider-agnostic adapters, §25)", () => {
    for (const family of onDisk) {
      const src = readFileSync(join(SCHOLAR_DIR, family), "utf8");
      expect(src, `${family}: vendor SDK import found`).not.toMatch(VENDOR_SDK_RE);
    }
  });

  it("every family keeps tenant identifiers out of client-supplied data paths", () => {
    const blocks = onDisk.map((family) => ({
      family,
      src: readFileSync(join(SCHOLAR_DIR, family), "utf8"),
    }));
    for (const { family, src } of blocks) {
      // Provisioning is the declared platform tenant selector: its super-admin
      // functions address TARGET tenants by id under the platform gate.
      if (family !== "provisioning.functions.ts") {
        expect(src, `${family}: client input contract must declare no tenant field`).not.toMatch(
          CLIENT_TENANT_FIELD_RE,
        );
      }
      // The platform-authority family (provisioning) may address
      // TARGET tenants/resources by validated client id under their own gates.
      if (family !== "provisioning.functions.ts") {
        for (const block of serverFnBlocks(src).values()) {
          expect(block, `${family}: must never query by a client-supplied tenant id`).not.toMatch(
            EQ_CLIENT_TENANT_RE,
          );
          expect(block, `${family}: must never stamp a client-supplied tenant id into a row`).not.toMatch(
            PAYLOAD_CLIENT_TENANT_RE,
          );
        }
      }
    }
  });
});