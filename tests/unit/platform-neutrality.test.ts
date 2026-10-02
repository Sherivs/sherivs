/**
 * CoreGrid — platform neutrality and no-hand-written-role-lists guard.
 *
 * Two laws are enforced here, both learned from real defects found in this
 * repository's own closures:
 *
 * 1. RUNTIME NEUTRALITY (AGENTS.md §33, phase-01 contract, BOUNDARIES.md): a
 *    domain-neutral platform module must not import a runtime/vertical. Scholar
 *    (runtime-001) reaches the neutral engine through an adapter in the runtime
 *    layer, so adding a second vertical never touches the engine.
 *
 * 2. NO HAND-WRITTEN ROLE LISTS. The Scholar catalog defines hundreds of reality
 *    roles and grows with the institution. A surface that enumerates roles by hand
 *    ("admin", "principal", "bursar", …) is stale the day the catalog grows, and a
 *    page-level role guard is not a security boundary anyway (AGENTS.md §34 — the UI
 *    is never the security boundary; Phase 08/RLS enforce).
 *
 * These are structural tests: they read the files and fail on the pattern, which is
 * what makes the rule survive future phases.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

/** Platform modules that must stay runtime-neutral (no vertical may be imported). */
const NEUTRAL_MODULES = [
  "frontend/src/lib/foundation-standards.ts",
  "frontend/src/lib/runtime-self-report.ts",
  "frontend/src/lib/agent-governance-report.ts",
  "frontend/src/lib/workspace-projection.ts",
  "frontend/src/lib/workspace-core.ts",
  "frontend/src/lib/workspace-composition.ts",
  "frontend/src/lib/workspace-governance.ts",
  "frontend/src/lib/workspace-membership.ts",
  "frontend/src/lib/workspace-engine/navigation.ts",
  "frontend/src/lib/trust-fabric-report.ts",
  "frontend/src/lib/runtime/installed-runtimes.ts",
  "frontend/src/lib/communication-providers.ts",
  "frontend/src/lib/communication-steward.ts",
  "frontend/src/lib/communication-steward-report.ts",
  "frontend/src/lib/academic-curriculum.ts",
  "frontend/src/lib/academic-assessment.ts",
  "frontend/src/lib/academic-intelligence-report.ts",
  "frontend/src/lib/scheduling-conflicts.ts",
  "frontend/src/lib/scheduling-quality.ts",
  "frontend/src/lib/scheduling-intelligence-report.ts",
  "frontend/src/lib/financial-splits.ts",
  "frontend/src/lib/financial-routing.ts",
  "frontend/src/lib/financial-journal.ts",
  "frontend/src/lib/financial-tax.ts",
  "frontend/src/lib/financial-intelligence-report.ts",
];

/** Platform/super-admin surfaces: control-plane UI, never a vertical's portal. */
const PLATFORM_SURFACES = [
  "frontend/src/routes/platform.tsx",
  "frontend/src/routes/_authenticated/super-admin/runtime-contracts.tsx",
  "frontend/src/routes/_authenticated/super-admin/agent-governance.tsx",
  "frontend/src/routes/_authenticated/super-admin/workspace-projection.tsx",
  "frontend/src/routes/_authenticated/super-admin/tenants.tsx",
  "frontend/src/routes/_authenticated/super-admin/trust-fabric.tsx",
  "frontend/src/routes/_authenticated/super-admin/communication-steward.tsx",
  "frontend/src/routes/_authenticated/super-admin/academic-intelligence.tsx",
  "frontend/src/routes/_authenticated/super-admin/scheduling-intelligence.tsx",
  "frontend/src/routes/_authenticated/super-admin/financial-operations.tsx",
];

/** Imports that would couple a neutral module to one vertical's ontology. */
const VERTICAL_IMPORT_PATTERNS = [
  /from\s+"@\/lib\/runtime\/scholar/,
  /from\s+"@\/lib\/scholar\//,
  /from\s+"@\/lib\/scholar-/,
  /from\s+"@\/lib\/education-/,
];

/** A literal role array: `allow={["admin", "principal"]}` or `ROLES = [...]`. */
const HAND_WRITTEN_ROLE_LIST = /allow=\{\[\s*"|const\s+\w*ROLES?\w*\s*(?::[^=]+)?=\s*\[/;

describe("Platform neutrality — no vertical leaks into the neutral engine", () => {
  for (const moduleRef of NEUTRAL_MODULES) {
    it(`${moduleRef} imports no runtime/vertical`, () => {
      const source = read(moduleRef);
      for (const pattern of VERTICAL_IMPORT_PATTERNS) {
        expect(source, `${moduleRef} must not match ${pattern}`).not.toMatch(pattern);
      }
    });
  }

  it("keeps the Scholar projection adapter in the runtime layer", () => {
    const adapter = read("frontend/src/lib/runtime/scholar-workspace-projection.ts");
    // The adapter is the only bridge, and it must be catalog-driven.
    expect(adapter).toContain("@/lib/runtime/nav-registry");
    expect(adapter).toContain("Object.keys(");
    expect(adapter).toContain("EDUCATION_REALITY_ROLES");

    // The neutral engine may *say* it is neutral; it must not import a vertical.
    const projection = read("frontend/src/lib/workspace-projection.ts");
    for (const pattern of VERTICAL_IMPORT_PATTERNS) {
      expect(projection, `workspace-projection.ts must not match ${pattern}`).not.toMatch(pattern);
    }
    expect(projection).not.toMatch(/from\s+"@\/lib\/runtime\//);
  });
});

describe("No hand-written role lists in platform surfaces", () => {
  for (const surfaceRef of PLATFORM_SURFACES) {
    it(`${surfaceRef} declares no role list of its own`, () => {
      const source = read(surfaceRef);
      expect(source, `${surfaceRef} must not hardcode roles`).not.toMatch(HAND_WRITTEN_ROLE_LIST);
    });
  }

  it("derives the workspace projection from the catalog instead of a role list", () => {
    const surface = read("frontend/src/routes/_authenticated/super-admin/workspace-projection.tsx");

    expect(surface).toContain("@/lib/runtime/scholar-workspace-projection");
    expect(surface).toContain("scholarRoleWorkspaceCoverage");
    expect(surface).not.toMatch(/"(admin|principal|bursar|driver|hq|super_admin)"/);
  });

  it("enumerates workspace kinds from the catalog, never from a typed-out list", () => {
    const adapter = read("frontend/src/lib/runtime/scholar-workspace-projection.ts");

    expect(adapter).toContain("Object.keys(");
    expect(adapter).toContain("SCHOLAR_WORKSPACE_LABELS");
    expect(adapter).not.toMatch(/SCHOLAR_WORKSPACE_KINDS\s*=\s*\[/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * LAW 3: only a runtime layer may name a runtime.
 *
 * CoreGrid is the platform; a runtime is an application installed on the kernel.
 * Scholar is runtime-001 — the first consumer of these contracts, never their
 * owner (owner decision, 2026-09-16). Seventy-three kernel and capability modules
 * had introduced themselves as "CoreGrid Scholar — …", which quietly taught every
 * later phase that the platform *is* one application. The frames were neutralised
 * by `scripts/neutralise-scholar-framing.mjs` (comments only, provably inert) and
 * this block keeps them neutral: a later phase cannot re-frame the kernel.
 * ────────────────────────────────────────────────────────────*/

/** Paths that belong to a runtime layer: there, a runtime's own name is correct. */
const RUNTIME_LAYER = [
  /^frontend\/src\/lib\/scholar\//,
  /^frontend\/src\/lib\/scholar-[^/]+\.tsx?$/,
  /^frontend\/src\/lib\/runtime\/scholar[^/]*\.tsx?$/,
  /^frontend\/src\/lib\/runtime\/scholar\/[^/]+\.tsx?$/,
  /^frontend\/src\/routes\/_authenticated\/scholar\//,
  // The runtime's own row/insert/update aliases for the tables it owns.
  /^frontend\/src\/types\/coregrid-scholar\.ts$/,
  // A script whose whole purpose is to verify runtime-001's own configuration.
  /^scripts\/[^/]*scholar[^/]*$/,
];

/** A comment line claiming to belong to a runtime's subsystem. */
const SELF_IDENTIFICATION = /^\s*(?:\/\*|\*|\/\/)\s*CoreGrid Scholar\b/m;

function walkSources(ref: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, ref), { withFileTypes: true })) {
    const child = `${ref}/${entry.name}`;
    if (entry.isDirectory()) walkSources(child, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
}

describe("Only a runtime layer may name a runtime", () => {
  const sources = [...walkSources("frontend/src"), ...walkSources("scripts")].filter(
    (ref) => !RUNTIME_LAYER.some((pattern) => pattern.test(ref)),
  );

  it("no kernel or capability file introduces itself as a runtime's subsystem", () => {
    const offenders = sources.filter((ref) => SELF_IDENTIFICATION.test(read(ref)));
    expect(offenders).toEqual([]);
  });

  it("no kernel module names a runtime at all — the runtime consumes the kernel", () => {
    const kernelModules = sources.filter((ref) => /^frontend\/src\/lib\/[^/]+\.ts$/.test(ref));
    const offenders = kernelModules.filter((ref) => read(ref).includes("CoreGrid Scholar"));
    expect(offenders).toEqual([]);
  });

  it("keeps the remediation script report-only for anything that is not a comment", () => {
    const script = read("scripts/neutralise-scholar-framing.mjs");

    // The script may rewrite comment lines; every other occurrence is a human
    // decision, because a string may be a real product name.
    expect(script).toContain("COMMENT_SELF_IDENTIFICATION");
    expect(script).toContain("needsHuman");
    expect(script).toContain("RUNTIME_LAYER");
  });
});

/* ─────────────────────────────────────────────────────────────
 * LAW 4: the kernel owns no runtime's DATA, and the shell renders what is INSTALLED.
 *
 * `frontend/src/lib/workspace-engine/nav-catalog.ts` held ~1,070 lines of one runtime's
 * navigation data inside the kernel's workspace engine, and the platform shell imported it
 * directly — so the platform read as if it had been built for that runtime. The data now
 * lives in the runtime layer (`lib/runtime/scholar-nav-catalog.ts`), a runtime-layer
 * registry lists what is installed (`lib/runtime/nav-registry.ts`), and the shell renders
 * `ALL_NAV_CONTRIBUTIONS`. This block keeps it that way.
 * ────────────────────────────────────────────────────────────*/

describe("The kernel owns no runtime's data", () => {
  it("keeps runtime navigation contributions out of the kernel's workspace engine", () => {
    for (const ref of walkSources("frontend/src/lib/workspace-engine")) {
      const source = read(ref);
      expect(source, `${ref} must hold no runtime contribution data`).not.toMatch(
        /runtimeRef:\s*RUNTIME_/,
      );
      expect(source, `${ref} must not narrate a runtime`).not.toContain("Scholar");
    }
  });

  it("renders navigation from the installed-runtime registry, not from one catalog", () => {
    const registry = read("frontend/src/lib/runtime/nav-registry.ts");
    expect(registry).toContain("INSTALLED_NAV_CONTRIBUTION_SETS");
    expect(registry).toContain("ALL_NAV_CONTRIBUTIONS");

    const shell = read("frontend/src/routes/_authenticated/route.tsx");
    expect(shell).toContain("ALL_NAV_CONTRIBUTIONS");
    expect(shell).not.toContain("SCHOLAR_NAV_CONTRIBUTIONS");
  });

  it("keeps a runtime's identity out of the platform's identity module", () => {
    const platform = read("frontend/src/lib/platform.ts");
    expect(platform).toContain("PLATFORM_NAME");
    expect(platform, "the platform module owns the platform, not a runtime").not.toContain(
      "SCHOLAR_RUNTIME",
    );

    const installed = read("frontend/src/lib/runtime/installed-runtimes.ts");
    expect(installed).toContain("INSTALLED_RUNTIMES");
    expect(installed).toContain("INSTALLED_RUNTIME_NAME");
  });

  it("keeps the platform gate's vocabulary generic", () => {
    const gate = read("frontend/src/lib/capability-gate.ts");
    expect(gate).toContain("evaluateRuntimeCapability");
    expect(gate).toContain("MEMBERSHIP_FOR_NAV_KIND");
    expect(gate, "the platform gate must not name a runtime's symbols").not.toContain(
      "evaluateScholarCapability",
    );
    expect(gate).not.toContain("SCHOLAR_");
  });
});

/* ─────────────────────────────────────────────────────────────
 * LAW 5: outside the runtime layer, the platform speaks about an INSTALLED RUNTIME.
 *
 * A runtime's name in a platform file is not a neutral fact: it teaches every later phase
 * that the platform is that application. Where the platform must refer to what is
 * installed, it says "the installed runtime", and the runtime's own layer names itself.
 * ────────────────────────────────────────────────────────────*/

const RUNTIME_NARRATION =
  /CoreGrid Scholar|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;

describe("Only the runtime layer narrates a runtime", () => {
  const sources = [...walkSources("frontend/src"), ...walkSources("scripts")].filter(
    (ref) => !RUNTIME_LAYER.some((pattern) => pattern.test(ref)),
  );

  it("never narrates a runtime as the platform outside the runtime layer", () => {
    const offenders = sources.filter((ref) => RUNTIME_NARRATION.test(read(ref)));
    expect(offenders).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * LAW 6: the phase BLUEPRINTS state the platform, not one application.
 *
 * The 51 phase documents are read as law by every later phase, and 27 of them
 * presented one runtime as the platform ("CoreGrid Scholar's institutional
 * communication infrastructure", "Scholar is the first runtime", "Scholar-specific",
 * "SCHOLAR EXTENSIONS" …). They were normalised by
 * `scripts/normalise-phase-doc-framing.mjs`, which rewrites owner-framing statements
 * into platform statements and refuses to touch a bare runtime name it cannot classify.
 * This block makes the correction durable: a later phase cannot re-frame the blueprint,
 * and the runtime stays runtime-001 — the first installed consumer of the kernel.
 * ────────────────────────────────────────────────────────────*/

describe("The phase blueprints describe CoreGrid, not one runtime", () => {
  const phaseDocs = readdirSync(join(ROOT, "architecture"))
    .filter((name) => /^phase-\d\d-.*\.md$/.test(name))
    .map((name) => `architecture/${name}`);

  it("has phase documents to check", () => {
    expect(phaseDocs.length).toBeGreaterThan(50);
  });

  it("presents no runtime as the platform", () => {
    const ownerFraming =
      /CoreGrid\s+Scholar|Scholar's|Scholar is\b|Scholar consumes|Scholar owns|Scholar provides|Scholar-?specific|Scholar-only|Scholar platform|Scholar system|Scholar implementation|\bfor Scholar\b/i;
    const offenders = [];
    for (const ref of phaseDocs) {
      for (const [index, line] of read(ref).split("\n").entries()) {
        if (ownerFraming.test(line)) offenders.push(`${ref}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the runtime as the first installed consumer, never the platform", () => {
    // A document may name the runtime (runtime-001, R-001, a path in its own layer);
    // what it may not do is claim the runtime is the platform — enforced above. Here we
    // assert the normaliser still reports the blueprint clean, so the two instruments
    // cannot disagree.
    const result = spawnSync("node", ["scripts/normalise-phase-doc-framing.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.stdout).toContain("documents with owner-framing to rewrite: 0");
    expect(result.status).toBe(0);
  });
});
