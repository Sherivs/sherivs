/**
 * Sherivs Experience Contract — the UI is not security.
 *
 * The contract may only REMOVE options. These tests assert the separation of
 * the internal Sherivs boundary, tenant requirements, capability filtering,
 * high-risk escalation and that planned (route-less) destinations never render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNIVERSAL_CATALOG,
  UNIVERSAL_WORKSPACE_DESTINATIONS,
  experienceConfigurationSchema,
  resolveExperienceConfiguration,
  type ExperienceInput,
} from "@/lib/experience-system/experience-contract";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tree = readFileSync(join(ROOT, "frontend/src/routeTree.gen.ts"), "utf8");

const tenantA = { id: "tenant-a", activeRuntimes: [] as string[] };
const member = (capabilities: string[], over: Partial<ExperienceInput> = {}): ExperienceInput => ({
  surface: "workspace",
  actor: { authenticated: true, capabilities },
  tenant: tenantA,
  ...over,
});
const resolve = (i: ExperienceInput) => resolveExperienceConfiguration(i, UNIVERSAL_CATALOG);

describe("boundaries", () => {
  it("denies the internal surface to a tenant member", () => {
    const r = resolve({ ...member(["workspace.overview.view"]), surface: "internal" });
    expect(r.decision).toBe("DENY");
    expect(r.navigation).toEqual([]);
    expect(r.commands).toEqual([]);
  });

  it("allows the internal surface only to a verified platform operator, with no tenant merged in", () => {
    const r = resolve({
      surface: "internal",
      actor: { authenticated: true, platformOperator: true, capabilities: [] },
      tenant: tenantA,
    });
    expect(r.decision).toBe("ALLOW");
    expect(r.shell).toBe("internal");
    expect(r.tenantId).toBeNull();
  });

  it("denies unauthenticated access to workspace surfaces", () => {
    const r = resolve({ surface: "workspace", actor: { authenticated: false }, tenant: tenantA });
    expect(r.decision).toBe("DENY");
  });

  it("requires server-supplied tenant context for tenant surfaces", () => {
    const r = resolve({ ...member(["settings.view"]), tenant: null });
    expect(r.decision).toBe("DENY");
    expect(r.reason).toMatch(/tenant/i);
  });

  it("gives public surfaces no tenant data or authorized navigation", () => {
    const r = resolve({ surface: "public", actor: { authenticated: false }, tenant: tenantA });
    expect(r.decision).toBe("ALLOW");
    expect(r.tenantId).toBeNull();
    expect(r.navigation).toEqual([]);
  });

  it("denies invalid input rather than guessing", () => {
    const r = resolveExperienceConfiguration({ surface: "bogus" } as never, UNIVERSAL_CATALOG);
    expect(r.decision).toBe("DENY");
    expect(r.navigation).toEqual([]);
  });

  it("keeps anonymous organization-public free of authorized navigation", () => {
    const r = resolve({ surface: "organization-public", actor: { authenticated: false }, tenant: tenantA });
    expect(r.decision).toBe("ALLOW");
    expect(r.navigation).toEqual([]);
    expect(r.commands).toEqual([]);
  });
});

describe("capability filtering (can only remove)", () => {
  it("shows no destination without its capability", () => {
    expect(resolve(member([])).navigation).toEqual([]);
  });

  it("shows exactly the available destinations the actor is authorized for", () => {
    const r = resolve(member(["settings.view", "reality.view", "people.view"]));
    expect(r.navigation.map((n) => n.key).sort()).toEqual(["reality", "settings"]);
  });

  it("never renders planned destinations, even when authorized", () => {
    const allCaps = UNIVERSAL_WORKSPACE_DESTINATIONS.flatMap((d) => d.capabilities);
    const r = resolve(member(allCaps));
    const planned = UNIVERSAL_WORKSPACE_DESTINATIONS.filter((d) => d.availability === "planned");
    expect(planned.length).toBeGreaterThan(0);
    for (const p of planned) expect(r.navigation.map((n) => n.key)).not.toContain(p.key);
  });

  it("filters by active runtime", () => {
    const catalog = {
      destinations: [
        { key: "x", label: "X", iconKey: "i", url: "/x", capabilities: [], runtime: "runtime:a", availability: "available" as const, surfaces: ["workspace" as const] },
      ],
      commands: [],
    };
    const without = resolveExperienceConfiguration(member([]), catalog);
    const withRt = resolveExperienceConfiguration(
      member([], { tenant: { id: "t", activeRuntimes: ["runtime:a"] } }),
      catalog,
    );
    expect(without.navigation).toEqual([]);
    expect(withRt.navigation.map((n) => n.key)).toEqual(["x"]);
  });

  it("resolves high-risk commands to REQUIRE_APPROVAL, never ALLOW", () => {
    const catalog = {
      destinations: [],
      commands: [
        { key: "danger", label: "Danger", capabilities: ["a"], risk: "high" as const, availability: "available" as const, surfaces: ["workspace" as const] },
        { key: "safe", label: "Safe", capabilities: ["a"], risk: "low" as const, availability: "available" as const, surfaces: ["workspace" as const] },
      ],
    };
    const r = resolveExperienceConfiguration(member(["a"]), catalog);
    expect(r.commands).toEqual([
      { key: "danger", label: "Danger", decision: "REQUIRE_APPROVAL" },
      { key: "safe", label: "Safe", decision: "ALLOW" },
    ]);
  });

  it("hides a command the actor lacks the capability for", () => {
    const r = resolve(member([]));
    expect(r.commands.map((c) => c.key)).toEqual(["open-notifications"]);
  });

  it("does not leak one tenant's id into another actor's result", () => {
    const a = resolve(member(["settings.view"]));
    const b = resolve(member(["settings.view"], { tenant: { id: "tenant-b", activeRuntimes: [] } }));
    expect(a.tenantId).toBe("tenant-a");
    expect(b.tenantId).toBe("tenant-b");
  });
});

describe("output contract", () => {
  it("always satisfies the output schema", () => {
    const cases: ExperienceInput[] = [
      member(["settings.view"]),
      { surface: "public", actor: { authenticated: false }, tenant: null },
      { surface: "internal", actor: { authenticated: true }, tenant: null },
    ];
    for (const c of cases) {
      expect(experienceConfigurationSchema.safeParse(resolve(c)).success).toBe(true);
    }
  });

  it("only links available destinations to routes that exist", () => {
    const missing = UNIVERSAL_WORKSPACE_DESTINATIONS.filter(
      (d) => d.availability === "available" && !tree.includes(`'${d.url}'`) && !tree.includes(`'${d.url}/'`),
    ).map((d) => d.url);
    expect(missing).toEqual([]);
  });
});
