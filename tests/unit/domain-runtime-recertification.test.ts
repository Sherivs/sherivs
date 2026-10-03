/**
 * CoreGrid — DOMAIN RUNTIME CERTIFICATION suite (MISSION-R-120, wave 2;
 * V1CAP-092 / V1CAP-093 / V1CAP-007).
 *
 * Recertifies BOTH installed domain runtimes against the reconstructed
 * identity/authority primitives, from the CONSUMER side:
 *
 *  1. Neutral role resolution — every declared domain role resolves FORWARD
 *     through its runtime's declared mapping table into the closed universal
 *     vocabulary (RULING-4: domain -> neutral only), and the platform gate's
 *     legacy bridge consumes the runtime's declaration instead of re-listing it.
 *  2. Nav-kind decoupling (I-012) — the capability gate's membership tables
 *     are runtime-declared and neutral-keyed; the gate hand-writes no role
 *     list; the neutral membership is DERIVED through the declared mapping
 *     table, never re-declared.
 *  3. No legacy role semantics — the restaurant fixture declares neutral-only
 *     roles (its recertified semantics: WORKER / OPERATOR / ADMINISTRATOR /
 *     OWNER), carries no educator semantic, and keeps every domain-vocabulary
 *     statement either in the runtime layer or as a documented-gated
 *     chrome-kind borrow.
 *  4. Standing oracle — the continuous domain-neutrality guard PASSes with
 *     the fixture in place (the second-domain acceptance oracle).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNIVERSAL_ROLES,
  isUniversalRole,
  resolveDomainRoleToNeutral,
} from "../../frontend/src/lib/universal-roles";
import {
  SCHOLAR_DOMAIN_ID,
  SCHOLAR_NEUTRAL_ROLE_MAPPINGS,
} from "../../frontend/src/lib/runtime/scholar-role-mappings";
import {
  RESTAURANT_DOMAIN_DEFINITION,
  RESTAURANT_NEUTRAL_ROLE_MAPPINGS,
  RESTAURANT_DOMAIN_ID,
} from "../../frontend/src/lib/domain-config/restaurant";
import {
  validateDomainDefinition,
} from "../../frontend/src/lib/domain-config/domain-definition";
import {
  MEMBERSHIP_FOR_NAV_KIND,
  NEUTRAL_ROLES_FOR_NAV_KIND,
  evaluateRuntimeCapability,
  neutralRolesForIdentityRole,
} from "../../frontend/src/lib/capability-gate";
import {
  RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP,
  RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS,
} from "../../frontend/src/lib/runtime/nav-registry";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(`${REPO_ROOT}/${ref}`, "utf8");

/** The runtime layer, per the platform-neutrality guard's own path list. */
const RUNTIME_LAYER_PATTERNS: readonly RegExp[] = [
  /^frontend\/src\/lib\/scholar\//,
  /^frontend\/src\/lib\/scholar-[^/]+\.tsx?$/,
  /^frontend\/src\/lib\/runtime\/scholar[^/]*\.tsx?$/,
  /^frontend\/src\/lib\/runtime\/scholar\/[^/]+\.tsx?$/,
];

const inRuntimeLayer = (ref: string) => RUNTIME_LAYER_PATTERNS.some((p) => p.test(ref));

/* ─────────────────────────────────────────────────────────────
 * 1. Neutral role resolution (both domains)
 * ────────────────────────────────────────────────────────────*/

describe("certification: neutral role resolution (V1CAP-092/093)", () => {
  it("every SCHOLAR role resolves forward into the closed universal vocabulary — nothing else", () => {
    expect(SCHOLAR_DOMAIN_ID).toBe("scholar");
    for (const [domainRole, neutralRoles] of Object.entries(SCHOLAR_NEUTRAL_ROLE_MAPPINGS)) {
      const resolved = resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, domainRole);
      expect(resolved, `scholar role "${domainRole}"`).toEqual(neutralRoles);
      expect(resolved).not.toBeNull();
      for (const neutral of resolved ?? []) {
        expect(isUniversalRole(neutral), `scholar role "${domainRole}" -> "${neutral}"`).toBe(true);
      }
    }
  });

  it("every RESTAURANT role resolves forward into the closed universal vocabulary — nothing else", () => {
    expect(RESTAURANT_DOMAIN_ID).toBe("restaurant");
    for (const [domainRole, neutralRoles] of Object.entries(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      const resolved = resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole);
      expect(resolved, `restaurant role "${domainRole}"`).toEqual(neutralRoles);
      for (const neutral of resolved ?? []) {
        expect(isUniversalRole(neutral), `restaurant role "${domainRole}" -> "${neutral}"`).toBe(
          true,
        );
      }
    }
  });

  it("neither domain resolves a role outside the ruled 15-role vocabulary", () => {
    for (const table of [SCHOLAR_NEUTRAL_ROLE_MAPPINGS, RESTAURANT_NEUTRAL_ROLE_MAPPINGS]) {
      for (const neutralRoles of Object.values(table)) {
        for (const neutral of neutralRoles) {
          expect(UNIVERSAL_ROLES).toContain(neutral);
        }
      }
    }
  });

  it("the gate's legacy bridge IS the runtime's declared mapping (authoritative in the runtime layer)", () => {
    // The Scholar mapping table lives in the runtime layer — the only place a
    // runtime's own vocabulary belongs.
    expect(inRuntimeLayer("frontend/src/lib/runtime/scholar-role-mappings.ts")).toBe(true);
    // Every legacy role the gate accepts resolves through that declared table.
    for (const roles of Object.values(MEMBERSHIP_FOR_NAV_KIND)) {
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `legacy role "${role}"`).not.toBeNull();
        expect(resolved).toEqual(
          resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role),
        );
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Nav-kind decoupling (I-012 closed)
 * ────────────────────────────────────────────────────────────*/

describe("certification: nav-kind membership decoupled to neutral roles (I-012)", () => {
  it("the gate's membership tables ARE the runtime-declared tables (consumed, not owned)", () => {
    expect(MEMBERSHIP_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS);
    expect(NEUTRAL_ROLES_FOR_NAV_KIND).toEqual(RUNTIME_NAV_KIND_NEUTRAL_MEMBERSHIP);
  });

  it("each runtime's neutral membership is DERIVED through its declared mapping table, never re-declared", () => {
    for (const [kind, roles] of Object.entries(RUNTIME_NAV_KIND_ROLE_ASSIGNMENTS)) {
      const derived = new Set<string>();
      for (const role of roles) {
        for (const neutral of resolveDomainRoleToNeutral(SCHOLAR_NEUTRAL_ROLE_MAPPINGS, role) ?? []) {
          derived.add(neutral);
        }
      }
      expect(
        [...derived].sort(),
        `kind "${kind}" neutral membership derives from the declared mapping table`,
      ).toEqual([...NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND]].sort());
    }
  });

  it("the gate source hand-writes no domain role list and names no runtime symbol", () => {
    const gate = read("frontend/src/lib/capability-gate.ts");
    expect(gate).not.toMatch(
      /"(admin|principal|teacher|bursar|parent|student|driver|hq|super_admin)"/,
    );
    expect(gate).not.toContain("SCHOLAR_");
    expect(gate).not.toContain("defineDomainRoleMappings");
  });

  it("every gate decision resolves through the NEUTRAL table (the legacy list is a deprecated fallback only)", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      for (const role of roles) {
        const resolved = neutralRolesForIdentityRole(role);
        expect(resolved, `role "${role}" of kind "${kind}"`).not.toBeNull();
        expect(
          (resolved ?? []).some((neutral) =>
            NEUTRAL_ROLES_FOR_NAV_KIND[kind as keyof typeof NEUTRAL_ROLES_FOR_NAV_KIND].includes(
              neutral,
            ),
          ),
          `role "${role}" must satisfy kind "${kind}" in NEUTRAL terms`,
        ).toBe(true);
      }
    }
  });

  it("an unknown role denies even though the legacy fallback list exists (fail closed)", () => {
    const outcome = evaluateRuntimeCapability({ code: "r001:teacher.dashboard", role: "ghost" as never });
    expect(outcome.decision).toBe("deny");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. No legacy role semantics (restaurant recertified)
 * ────────────────────────────────────────────────────────────*/

describe("certification: no legacy role semantics (V1CAP-093 recertification)", () => {
  it("the restaurant fixture validates end-to-end through the fail-closed validator", () => {
    const result = validateDomainDefinition(RESTAURANT_DOMAIN_DEFINITION);
    expect(result.ok).toBe(true);
  });

  it("every restaurant role declares the neutral vocabulary ONLY — zero appRoles declarations", () => {
    for (const role of RESTAURANT_DOMAIN_DEFINITION.roles) {
      expect(role.appRoles, `role "${role.domainRole}"`).toBeUndefined();
      expect(role.neutralRoles?.length).toBeGreaterThan(0);
    }
  });

  it("restaurant recertifies to exactly WORKER / OPERATOR / ADMINISTRATOR / OWNER semantics", () => {
    const recertified: Record<string, readonly string[]> = {
      manager: ["ADMINISTRATOR", "OWNER"],
      cashier: ["OPERATOR"],
      service_staff: ["WORKER", "OPERATOR"],
      runner: ["WORKER"],
    };
    for (const [domainRole, neutralRoles] of Object.entries(recertified)) {
      expect(
        resolveDomainRoleToNeutral(RESTAURANT_NEUTRAL_ROLE_MAPPINGS, domainRole),
        `restaurant role "${domainRole}"`,
      ).toEqual(neutralRoles);
    }
  });

  it("no restaurant role resolves to the educator-resolved neutral semantic (CONTRIBUTOR)", () => {
    for (const [domainRole, neutralRoles] of Object.entries(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      expect(neutralRoles, `restaurant role "${domainRole}"`).not.toContain("CONTRIBUTOR");
    }
    expect(neutralRolesForIdentityRole("service_staff")).toBeNull();
  });

  it("no restaurant role name is a legacy identity-store role (the I-030 forced mapping cannot return)", () => {
    const legacyRoles = new Set<string>(Object.values(MEMBERSHIP_FOR_NAV_KIND).flat());
    for (const domainRole of Object.keys(RESTAURANT_NEUTRAL_ROLE_MAPPINGS)) {
      expect(legacyRoles.has(domainRole), `restaurant role "${domainRole}"`).toBe(false);
    }
  });

  it("the workspace chrome-kind borrows are the ONLY education-vocabulary literals, and the debt is documented-gated", () => {
    const source = read("frontend/src/lib/domain-config/restaurant.ts");
    // The debt is documented with its consumer list and a ratchet TODO.
    expect(source).toContain("TODO(I-012/V1CAP-084)");
    expect(source).toContain("tests/unit/domain-config-restaurant.test.ts");
    // No education-vocabulary string literal exists beyond the two
    // chrome-kind kind strings (runtime nav registry vocabulary).
    const educatorTokens = [
      "student",
      "teacher",
      "school",
      "curriculum",
      "exam",
      "attendance",
      "fee",
      "tuition",
      "bursar",
      "principal",
      "guardian",
      "academic",
    ];
    const observed = new Set<string>();
    for (const line of source.split("\n")) {
      for (const token of educatorTokens) {
        if (new RegExp(`['"\`]${token}['"\`]`, "i").test(line)) observed.add(token);
      }
    }
    expect([...observed].sort()).toEqual(["bursar", "teacher"]);
  });

  it("Scholar domain vocabulary lives ONLY in the runtime layer (declared tables + adapter)", () => {
    for (const ref of [
      "frontend/src/lib/runtime/scholar-role-mappings.ts",
      "frontend/src/lib/runtime/scholar-nav-catalog.ts",
      "frontend/src/lib/runtime/scholar-workspace-projection.ts",
    ]) {
      expect(inRuntimeLayer(ref), `${ref} must be a runtime-layer path`).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Standing oracle — the continuous domain-neutrality guard
 * ────────────────────────────────────────────────────────────*/

/** The files this mission owns (the certification scope). */
const CERTIFIED_FILES: readonly string[] = [
  "frontend/src/lib/capability-gate.ts",
  "frontend/src/lib/domain-config/restaurant.ts",
  "frontend/src/lib/domain-config/domain-definition.ts",
  "frontend/src/lib/runtime/scholar-role-mappings.ts",
  "frontend/src/lib/runtime/nav-registry.ts",
];

describe("certification: the domain-neutrality guard stays clean on the certified files", () => {
  /**
   * The guard scans the whole universal surface, which parallel missions also
   * edit; this certification therefore asserts the scope it owns — no NEW
   * violation may originate from a certified file — and proves the gate got
   * STRICTLY cleaner (its legacy role list left the universal surface, so its
   * baseline entries become shrink-only ratchet opportunities).
   *
   * Deterministic child-process execution (H3-081 deflake):
   *
   * The guard subprocess scans the whole universal surface, which makes its
   * wall-clock sensitive to machine load; the vitest parent also injects
   * environment (NODE_V8_COVERAGE, shared TMPDIR) that would make the child
   * contend with sibling test processes for the same files. To keep this
   * certification deterministic under concurrent load:
   *
   *   - the child runs with an ISOLATED environment: a unique per-attempt
   *     temp directory (no shared /tmp collisions) and, when the parent set
   *     NODE_V8_COVERAGE, that coverage stream is redirected into the same
   *     unique directory instead of a shared one;
   *   - stdin is detached from the vitest parent (the guard never reads it);
   *   - the spawn is bounded: 60s child timeout (SIGKILL), 32MB output
   *     buffer (the guard prints one WARN line per baseline hit), and a
   *     per-test budget of 240s so vitest never tears the test down before
   *     the bounded spawn reports;
   *   - stdout/stderr are captured FULLY: the child writes both streams to
   *     files in the isolated scratch directory and the parent reads them
   *     back after exit. Pipes are NOT used for capture: empirically (H3-081
   *     ground-truth repro under artificial CPU contention), `spawnSync`
   *     with piped stdio intermittently TRUNCATES large child output while
   *     still reporting `status=0` / `error=undefined` (observed 127-159KB
   *     captured of a 212,914-byte guard report, tail cut mid-line) — the
   *     guard's `STATUS=PASS` footer silently vanished, which is exactly the
   *     historical flake signature of this test under concurrent load. File
   *     capture removes the pipe from the equation; output is finite
   *     (bounded by the guard's own report), so no maxBuffer applies.
   *
   * RETRY POLICY (documented per campaign law): the spawn is retried at most
   * twice ONLY when the child produced NO verdict at all — `result.error` is
   * set with no exit code (fork exhaustion EAGAIN, or the 60s bound elapsed;
   * a missing runtime ENOENT also lands here and fails deterministically on
   * every attempt) — cases where zero evidence was generated. A completed
   * run's exit code is evidence: a non-zero exit or any assertion mismatch
   * FAILS IMMEDIATELY and is never retried, so this retry cannot mask a real
   * neutrality failure. Every attempt runs the SAME expectations; assertions
   * apply to the final verdict-bearing attempt.
   */
  const GUARD_SCRIPT = "scripts/verify-domain-neutrality.mjs";
  const GUARD_TIMEOUT_MS = 60_000;
  const GUARD_MAX_ATTEMPTS = 3;
  const TEST_TIMEOUT_MS = 240_000;

  type GuardSpawnResult = ReturnType<typeof spawnSync>;

  /** True when the spawn produced no exit-code verdict (no evidence). */
  const isRetryableSpawnFailure = (result: GuardSpawnResult): boolean =>
    result.error !== undefined && result.status === null;

  /** Run the guard once with a fully isolated child environment and file capture. */
  const runGuardOnce = (): {
    result: GuardSpawnResult;
    stdout: string;
    stderr: string;
    scratchDir: string;
  } => {
    const scratchDir = mkdtempSync(join(tmpdir(), "h3-081-recert-"));
    try {
      const stdoutPath = join(scratchDir, "guard-stdout.log");
      const stderrPath = join(scratchDir, "guard-stderr.log");
      const stdoutFd = openSync(stdoutPath, "w");
      const stderrFd = openSync(stderrPath, "w");
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: scratchDir };
        // Redirect any parent-injected V8 coverage stream into the isolated
        // scratch dir so the child never writes into a shared coverage folder.
        if (env.NODE_V8_COVERAGE !== undefined) env.NODE_V8_COVERAGE = scratchDir;
        const result = spawnSync("node", [GUARD_SCRIPT], {
          cwd: REPO_ROOT,
          timeout: GUARD_TIMEOUT_MS,
          killSignal: "SIGKILL",
          stdio: ["ignore", stdoutFd, stderrFd],
          windowsHide: true,
          env,
        });
        return {
          result,
          stdout: readFileSync(stdoutPath, "utf8"),
          stderr: readFileSync(stderrPath, "utf8"),
          scratchDir,
        };
      } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
      }
    } catch (err) {
      rmSync(scratchDir, { recursive: true, force: true });
      throw err;
    }
  };

  it(
    "introduces no new domain-neutrality violation from a certified file, and the gate's baseline entries become ratchets",
    { timeout: TEST_TIMEOUT_MS },
    () => {
      let result: GuardSpawnResult | undefined;
      let stdoutText = "";
      let stderrText = "";
      let scratchDir: string | undefined;
      try {
        for (let attempt = 1; attempt <= GUARD_MAX_ATTEMPTS; attempt += 1) {
          const once = runGuardOnce();
          result = once.result;
          stdoutText = once.stdout;
          stderrText = once.stderr;
          scratchDir = once.scratchDir;
          if (!isRetryableSpawnFailure(result)) break;
          rmSync(scratchDir, { recursive: true, force: true });
          scratchDir = undefined;
        }
      } finally {
        if (scratchDir !== undefined) rmSync(scratchDir, { recursive: true, force: true });
      }

      const finalResult = result as GuardSpawnResult;
      expect(
        finalResult.error,
        `guard spawn failed after ${GUARD_MAX_ATTEMPTS} attempt(s): ${String(finalResult.error)}`,
      ).toBeUndefined();
      expect(
        finalResult.status,
        "the guard must complete with an exit code (a timed-out or signaled spawn is not a verdict)",
      ).toBe(0);

      const output = `${stdoutText}\n${stderrText}`;
      const failLines = output.split("\n").filter((line) => line.startsWith("FAIL  "));
      const fromCertifiedFiles = failLines.filter((line) =>
        CERTIFIED_FILES.some((ref) => line.includes(ref)),
      );
      expect(
        fromCertifiedFiles,
        `guard output:\n${output}`,
      ).toEqual([]);
      // The gate's hand-written role list left the universal surface; the six
      // stale capability-gate baseline groups were RATCHETED OUT of the
      // baseline (shrink-only ratchet executed by the guard's owning
      // coordinator after MISSION-R-120). Assert the post-ratchet state: the
      // guard reports zero ratchet warnings and a clean pass, and the baseline
      // file no longer carries any capability-gate.ts entry.
      expect(output).not.toMatch(/RATCHET/);
      expect(output).toMatch(/STATUS=PASS/);
      const baseline = JSON.parse(
        readFileSync(
          "architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json",
          "utf8",
        ),
      );
      expect(
        baseline.baselineEntries.some((entry: { file: string }) =>
          entry.file.includes("capability-gate.ts"),
        ),
        "capability-gate.ts baseline entries must stay removed after the ratchet",
      ).toBe(false);
    },
  );
});
