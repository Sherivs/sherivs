/**
 * CoreGrid — global shell ownership tests (MISSION H2-12, ADR-010 / J-047).
 *
 * Covers the platform shell ownership contract
 * (`frontend/src/lib/platform/global-shell.ts`):
 *  1. ownership vocabulary (the shell is platform-owned, one legal value)
 *  2. registry-only nav contribution admission (unregistered/forged content
 *     rejected; honest empty nav)
 *  3. capability-gated nav composition with provenance (presentation only)
 *  4. real-identity resolution hook (fails closed; asserted refs never trusted)
 *  5. tenant-context resolution hook (derived exclusively from the
 *     server-owned directory; fails closed)
 *  6. search provider contract (fan-out, tenant-scope withholding,
 *     per-provider failure containment)
 *  7. shell neutrality self-scan (the contract module carries no domain
 *     vocabulary, per the CI guard's own token lists)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SHELL_OWNER_LAYER,
  admitShellNavContributionSets,
  composeGlobalShell,
  composeShellNav,
  executeShellSearch,
  resolveShellIdentity,
  resolveShellTenantContext,
  shellSwitcherOptions,
  type ShellNavContributionSet,
  type ShellSearchProvider,
} from "../../frontend/src/lib/platform/global-shell";

/* ────────────────────────────────────────────────────────────
 * Fixtures (deliberately domain-neutral — the contract is too)
 * ────────────────────────────────────────────────────────────*/

const DECLARED_RUNTIMES = new Set(["runtime:one", "runtime:two"]);

function section(
  runtimeRef: string,
  entries: Array<{
    key: string;
    label?: string;
    capabilityRefs?: readonly string[];
    orderHint?: number;
  }>,
  sectionKey = `${runtimeRef}:main`,
): ShellNavContributionSet {
  return {
    runtimeRef,
    sections: [
      {
        sectionKey,
        sectionLabel: "Main",
        runtimeRef,
        entries: entries.map((entry) => ({
          key: entry.key,
          label: entry.label ?? entry.key,
          iconKey: "panel",
          url: `/${entry.key}`,
          capabilityRefs: entry.capabilityRefs ?? [],
          orderHint: entry.orderHint ?? 0,
        })),
      },
    ],
  };
}

/* ────────────────────────────────────────────────────────────
 * 1. Ownership vocabulary
 * ────────────────────────────────────────────────────────────*/

describe("shell ownership (ADR-010: the platform layer owns the shell)", () => {
  it("declares the platform layer as the sole legal owner", () => {
    expect(SHELL_OWNER_LAYER).toBe("platform");
  });
});

/* ────────────────────────────────────────────────────────────
 * 2. Registry-only contribution admission
 * ────────────────────────────────────────────────────────────*/

describe("nav contribution admission (registry-only, provenance-checked)", () => {
  it("admits declared runtimes and renders nothing from an empty registry", () => {
    const empty = composeShellNav([], new Set(["any"]));
    expect(empty).toEqual([]);

    const admission = admitShellNavContributionSets(
      [section("runtime:one", [{ key: "overview" }])],
      DECLARED_RUNTIMES,
    );
    expect(admission.rejected).toEqual([]);
    expect(admission.admitted).toHaveLength(1);
  });

  it("rejects an undeclared runtime's contribution set", () => {
    const rogue = section("runtime:rogue", [{ key: "rogue" }]);
    const admission = admitShellNavContributionSets([rogue], DECLARED_RUNTIMES);
    expect(admission.admitted).toEqual([]);
    expect(admission.rejected).toEqual([
      {
        runtimeRef: "runtime:rogue",
        reason: "Runtime is not declared by the installed-runtime manifest",
      },
    ]);
    // ...and nothing renders from it, whatever capabilities the actor holds.
    expect(composeShellNav(admission.admitted, new Set(["any"]))).toEqual([]);
  });

  it("rejects a set carrying a section published by a different runtime", () => {
    const forged: ShellNavContributionSet = {
      runtimeRef: "runtime:one",
      sections: [
        {
          sectionKey: "foreign",
          sectionLabel: "Foreign",
          runtimeRef: "runtime:two",
          entries: [
            {
              key: "foreign.entry",
              label: "Foreign",
              iconKey: "panel",
              url: "/foreign",
              capabilityRefs: [],
              orderHint: 0,
            },
          ],
        },
      ],
    };
    const admission = admitShellNavContributionSets([forged], DECLARED_RUNTIMES);
    expect(admission.admitted).toEqual([]);
    expect(admission.rejected[0]?.reason).toContain("not published by");
  });
});

/* ────────────────────────────────────────────────────────────
 * 3. Nav composition (capability gating is presentation only)
 * ────────────────────────────────────────────────────────────*/

describe("nav composition (capability-gated, provenance-traced, honest empty)", () => {
  const sets = [
    section("runtime:one", [
      { key: "a.overview", orderHint: 1 },
      { key: "a.restricted", capabilityRefs: ["secret.capability"], orderHint: 0 },
    ]),
    section("runtime:two", [{ key: "b.overview", orderHint: 0 }]),
  ];

  it("hides capability-gated entries from actors without the capability", () => {
    const sections = composeShellNav(sets, new Set<string>());
    // Sections keep admission order; entries sort within their section.
    expect(sections.map((s) => s.runtimeRef)).toEqual(["runtime:one", "runtime:two"]);
    expect(sections.flatMap((s) => s.entries.map((e) => e.key))).toEqual([
      "a.overview",
      "b.overview",
    ]);
  });

  it("shows gated entries and keeps per-entry runtime provenance when granted", () => {
    const sections = composeShellNav(sets, new Set(["secret.capability"]));
    const keys = sections.flatMap((s) => s.entries.map((e) => e.key));
    // orderHint governs within sections; ordering is deterministic.
    expect(keys).toEqual(["a.restricted", "a.overview", "b.overview"]);
    for (const sectionItem of sections) {
      for (const entry of sectionItem.entries) {
        expect(DECLARED_RUNTIMES.has(sectionItem.runtimeRef)).toBe(true);
      }
    }
  });

  it("resolves an honest empty nav when every section is gated away", () => {
    const gated = section("runtime:one", [
      { key: "locked", capabilityRefs: ["unheld.capability"] },
    ]);
    expect(composeShellNav([gated], new Set<string>())).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────
 * 4. Real-identity resolution hook
 * ────────────────────────────────────────────────────────────*/

describe("identity resolution hook (fails closed; assertions never trusted)", () => {
  it("fails closed with no verified identity", () => {
    const hint = { assertedActorRef: "actor-1", assertedTenantRef: "tenant-1" };
    expect(resolveShellIdentity(hint, null).ok).toBe(false);
    expect(resolveShellIdentity(hint, { actorRef: null, tenantRef: null }).ok).toBe(false);
    expect(resolveShellIdentity(hint, { actorRef: "actor-1", tenantRef: null }).ok).toBe(false);
    expect(resolveShellIdentity(hint, { actorRef: null, tenantRef: "tenant-1" }).ok).toBe(false);
  });

  it("resolves only from the server-verified record, never the session hint", () => {
    const forgedHint = { assertedActorRef: "actor-evil", assertedTenantRef: "tenant-evil" };
    const resolution = resolveShellIdentity(forgedHint, {
      actorRef: "actor-real",
      tenantRef: "tenant-real",
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.actorRef).toBe("actor-real");
      expect(resolution.tenantRef).toBe("tenant-real");
    }
  });
});

/* ────────────────────────────────────────────────────────────
 * 5. Tenant-context resolution hook (submit-resolve switcher)
 * ────────────────────────────────────────────────────────────*/

describe("tenant context resolution (derived from the server directory only)", () => {
  const directory = [
    { workspaceRef: "ws-1", tenantRef: "tenant-1", label: "Workspace One" },
    { workspaceRef: "ws-2", tenantRef: "tenant-2", label: "Workspace Two" },
  ];
  const identity = resolveShellIdentity(
    { assertedActorRef: null, assertedTenantRef: null },
    { actorRef: "actor-1", tenantRef: "tenant-1" },
  );

  it("offers only directory entries the actor is authorized for", () => {
    const options = shellSwitcherOptions(directory, ["ws-1"]);
    expect(options).toEqual([{ workspaceRef: "ws-1", label: "Workspace One" }]);
  });

  it("derives tenant context from the directory record, never from the choice", () => {
    const forged = { workspaceRef: "ws-2", tenantRef: "tenant-evil" } as {
      workspaceRef: string;
      tenantRef?: string;
    };
    const result = resolveShellTenantContext(forged, directory, ["ws-2"], identity);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.tenantRef).toBe("tenant-2");
      expect(result.context.resolvedBy).toBe("server-directory");
      expect(result.context.actorRef).toBe("actor-1");
    }
  });

  it("fails closed on an unknown or unauthorized choice", () => {
    expect(
      resolveShellTenantContext({ workspaceRef: "ws-unknown" }, directory, ["ws-1"], identity).ok,
    ).toBe(false);
    expect(
      resolveShellTenantContext({ workspaceRef: "ws-2" }, directory, ["ws-1"], identity).ok,
    ).toBe(false);
  });

  it("fails closed when identity is unresolved — no context without an actor", () => {
    const unresolved = resolveShellIdentity(
      { assertedActorRef: "actor-1", assertedTenantRef: "tenant-1" },
      null,
    );
    const result = resolveShellTenantContext({ workspaceRef: "ws-1" }, directory, ["ws-1"], unresolved);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Identity unresolved");
  });
});

/* ────────────────────────────────────────────────────────────
 * 6. Search provider contract (fan-out, scope, containment)
 * ────────────────────────────────────────────────────────────*/

describe("global search contract (registered providers, tenant-scoped, fail-closed)", () => {
  const query = { text: "alpha", tenantRef: "tenant-1", actorRef: "actor-1", limit: 10 };

  function provider(
    providerRef: string,
    hits: Array<{ resultRef: string; scope: "platform" | "tenant-1" | "tenant-9" }>,
    boom = false,
  ): ShellSearchProvider {
    return {
      providerRef,
      kinds: ["search"],
      search: () => {
        if (boom) throw new Error("provider failure");
        return hits.map((hit) => ({
          providerRef,
          resultRef: hit.resultRef,
          label: hit.resultRef,
          url: `/r/${hit.resultRef}`,
          scope:
            hit.scope === "platform"
              ? { kind: "platform" }
              : { kind: "tenant", tenantRef: hit.scope },
        }));
      },
    };
  }

  it("fans out to registered providers and tags every hit with its provider", () => {
    const outcome = executeShellSearch(
      [provider("runtime:one", [{ resultRef: "r1", scope: "tenant-1" }])],
      query,
    );
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]?.providerRef).toBe("runtime:one");
    expect(outcome.hits[0]?.scope).toEqual({ kind: "tenant", tenantRef: "tenant-1" });
  });

  it("withholds hits scoped to another tenant; platform-scope hits pass", () => {
    const outcome = executeShellSearch(
      [
        provider("runtime:one", [
          { resultRef: "mine", scope: "tenant-1" },
          { resultRef: "foreign", scope: "tenant-9" },
        ]),
        provider("runtime:two", [{ resultRef: "shared", scope: "platform" }]),
      ],
      query,
    );
    expect(outcome.hits.map((hit) => hit.resultRef)).toEqual(["mine", "shared"]);
    expect(outcome.withheldByProvider).toEqual({ "runtime:one": 1 });
  });

  it("contains provider failure: a throwing provider is withheld, others still serve", () => {
    const outcome = executeShellSearch(
      [
        provider("runtime:broken", [{ resultRef: "x", scope: "tenant-1" }], true),
        provider("runtime:healthy", [{ resultRef: "y", scope: "tenant-1" }]),
      ],
      query,
    );
    expect(outcome.hits.map((hit) => hit.resultRef)).toEqual(["y"]);
    expect(outcome.withheldByProvider).toEqual({ "runtime:broken": 1 });
  });

  it("caps results at the query limit deterministically", () => {
    const outcome = executeShellSearch(
      [
        provider("runtime:one", [
          { resultRef: "b", scope: "tenant-1" },
          { resultRef: "a", scope: "tenant-1" },
          { resultRef: "c", scope: "tenant-1" },
        ]),
      ],
      { ...query, limit: 2 },
    );
    expect(outcome.hits.map((hit) => hit.resultRef)).toEqual(["a", "b"]);
  });
});

/* ────────────────────────────────────────────────────────────
 * 7. Shell surface assembly + neutrality self-scan
 * ────────────────────────────────────────────────────────────*/

describe("global shell surface assembly", () => {
  it("composes from admitted sets only and always names the platform owner", () => {
    const surface = composeGlobalShell({
      declaredRuntimeRefs: DECLARED_RUNTIMES,
      navSets: [
        section("runtime:one", [{ key: "overview" }]),
        section("runtime:rogue", [{ key: "rogue" }]),
      ],
      actorCapabilityRefs: new Set<string>(),
      searchProviders: [],
    });
    expect(surface.owner).toBe("platform");
    expect(surface.nav.flatMap((s) => s.entries.map((e) => e.key))).toEqual(["overview"]);
    expect(surface.searchProviders).toEqual([]);
  });
});

/**
 * Extract the neutrality guard's token vocabulary straight from
 * scripts/verify-domain-neutrality.mjs so this scan can never drift
 * from the CI guard's definition.
 */
function guardTokens(): { strict: readonly string[]; literal: readonly string[] } {
  const source = readFileSync(
    fileURLToPath(new URL("../../scripts/verify-domain-neutrality.mjs", import.meta.url)),
    "utf8",
  );
  function tokensOf(constName: string): string[] {
    const block = source.match(new RegExp(`const ${constName} = \\[[\\s\\S]*?\\];`));
    if (!block) throw new Error(`Cannot locate ${constName} in the neutrality guard`);
    return [...block[0].matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  }
  return { strict: tokensOf("STRICT_TOKENS"), literal: tokensOf("LITERAL_TOKENS") };
}

const TOKENS = guardTokens();

describe("shell contract neutrality (ADR-010: no domain vocabulary in the shell contract)", () => {
  it("keeps the ownership contract module free of domain tokens", () => {
    const content = readFileSync(
      fileURLToPath(
        new URL("../../frontend/src/lib/platform/global-shell.ts", import.meta.url),
      ),
      "utf8",
    );
    const hits: string[] = [];
    content.split(/\r?\n/).forEach((line, index) => {
      for (const token of TOKENS.strict) {
        if (new RegExp(`\\b${token}\\b`, "i").test(line)) {
          hits.push(`global-shell.ts:${index + 1} ${token}`);
        }
      }
      for (const token of TOKENS.literal) {
        if (new RegExp(`['"\`]${token}['"\`]`, "i").test(line)) {
          hits.push(`global-shell.ts:${index + 1} ${token}`);
        }
      }
    });
    expect(hits.join("\n")).toBe("");
  });

  it("keeps zero vendor imports — the contract is pure and provider-agnostic", () => {
    const content = readFileSync(
      fileURLToPath(
        new URL("../../frontend/src/lib/platform/global-shell.ts", import.meta.url),
      ),
      "utf8",
    );
    // The contract module is pure: it imports nothing at all.
    expect(content.match(/^import /gm)).toBeNull();
  });
});
