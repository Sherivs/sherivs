/**
 * CoreGrid — H3 C-025 / L-T-007 tests: runtime egress allowlist enforcement
 * at the AI-gateway boundary (`frontend/src/lib/ai-gateway/egress-allowlist.ts`).
 *
 * The suite proves the enforcement half of the runtime gap:
 *  1. deny-by-default — an empty allowlist denies everything; nothing
 *     egresses without an operator-declared endpoint;
 *  2. fail-closed construction — malformed endpoint declarations (non-https,
 *     embedded credentials, non-registrable hosts, duplicate declarations,
 *     malformed methods/path prefixes, an invalid injected clock) throw;
 *  3. typed denials — every rejection carries a typed deny code, never a
 *     guess: unparseable_url, non_https_scheme, embedded_credentials,
 *     unregistered_endpoint, endpoint_not_bound_to_provider,
 *     port_not_permitted, path_not_permitted, method_not_permitted,
 *     invalid_request, invalid_clock;
 *  4. composition with the model registry (imported READ-ONLY) — egress is
 *     permitted only for an invocation the registry routed, to an endpoint
 *     bound to the routed provider class; a registry deny is an egress deny;
 *  5. guarded transport handoff — the allowlist is the only channel: a
 *     denial NEVER touches the transport; a completed call passes the
 *     original URL; a transport failure is contained by error NAME only;
 *  6. secret hygiene — audit records carry scheme/host/port/path/method
 *     only; query strings (credential carriers) never appear anywhere;
 *  7. auditability — the ledger is append-only with deterministic ids;
 *  8. purity/determinism — identical inputs give identical decisions;
 *     inputs are never mutated.
 *
 * All endpoint URLs are synthetic (.invalid TLD). No test touches a network.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EgressAllowlist,
  type DeclaredEgressEndpoint,
  type EgressAuditRecord,
  type EgressDecision,
  type EgressOutcome,
} from "@/lib/ai-gateway/egress-allowlist";
import { ModelRegistry } from "@/lib/ai-gateway/model-registry";
import type { GatewayPurpose } from "@/lib/metering/usage-ledger";

const T0 = "2026-10-03T00:00:00.000Z";

function clockAt(instants: readonly string[]) {
  let ticks = 0;
  return () => {
    const value = instants[Math.min(ticks, instants.length - 1)];
    ticks += 1;
    return value;
  };
}

function fixedClock(at: string = T0): () => string {
  return () => at;
}

function allowlistWith(
  bindings: ConstructorParameters<typeof EgressAllowlist>[0]["bindings"],
  at: string = T0,
): EgressAllowlist {
  return new EgressAllowlist({ bindings, now: fixedClock(at) });
}

const INFERENCE_ONE = "https://inference.provider-one.invalid/v1";
const INFERENCE_TWO = "https://inference.provider-two.invalid/api";

const MODEL_PROFILE = {
  contextWindowTokens: 128_000,
  latencyTier: "low" as const,
  costTier: "medium" as const,
};

/** A registry with two provider classes; purpose routed to class one. */
function registryWithTwoClasses(): ModelRegistry {
  return new ModelRegistry({
    models: [
      { id: "core/alpha", providerClass: "inference-primary", profile: MODEL_PROFILE },
      { id: "core/beta", providerClass: "inference-secondary", profile: MODEL_PROFILE },
    ],
    fallbackChains: { summarization: ["core/alpha"] },
  });
}

function routedAllow(
  registry: ModelRegistry,
  url: string,
  purpose: GatewayPurpose = "summarization",
) {
  const routing = registry.resolveModel({ purpose });
  if (routing.decision !== "allow") throw new Error("fixture: routing denied");
  return { url, routing };
}

describe("H3-025: fail-closed construction", () => {
  it("accepts an empty allowlist (deny-by-default posture) without throwing", () => {
    const allowlist = allowlistWith([]);
    expect(allowlist.declaredEndpoints()).toEqual([]);
  });

  it("throws on a non-https endpoint declaration", () => {
    expect(
      () =>
        new EgressAllowlist({
          bindings: [{ providerClass: "p", endpoint: "http://endpoint.provider-one.invalid/v1" }],
        }),
    ).toThrow(TypeError);
  });

  it("throws on a declaration embedding credentials", () => {
    expect(
      () =>
        new EgressAllowlist({
          bindings: [{ providerClass: "p", endpoint: "https://key@endpoint.provider-one.invalid/v1" }],
        }),
    ).toThrow(TypeError);
  });

  it("throws on a declaration carrying a query string or fragment", () => {
    expect(
      () =>
        new EgressAllowlist({
          bindings: [{ providerClass: "p", endpoint: "https://endpoint.provider-one.invalid/v1?api=1" }],
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new EgressAllowlist({
          bindings: [{ providerClass: "p", endpoint: "https://endpoint.provider-one.invalid/v1#frag" }],
        }),
    ).toThrow(TypeError);
  });

  it("throws on non-registrable endpoint hosts: IP literals, localhost, single-label", () => {
    for (const endpoint of [
      "https://192.0.2.1/v1",
      "https://[2001:db8::1]/v1",
      "https://localhost/v1",
      "https://sub.localhost/v1",
      "https://barehost/v1",
    ]) {
      expect(
        () => new EgressAllowlist({ bindings: [{ providerClass: "p", endpoint }] }),
      ).toThrow(TypeError);
    }
  });

  it("throws on duplicate endpoint declarations", () => {
    expect(
      () =>
        new EgressAllowlist({
          bindings: [
            { providerClass: "p", endpoint: INFERENCE_ONE },
            { providerClass: "p", endpoint: "https://inference.provider-one.invalid/v1/" },
          ],
        }),
    ).toThrow(/duplicate/i);
  });

  it("throws on an empty provider class or unparseable endpoint", () => {
    expect(() => allowlistWith([{ providerClass: "  ", endpoint: INFERENCE_ONE }])).toThrow(TypeError);
    expect(() => allowlistWith([{ providerClass: "p", endpoint: "not a url" }])).toThrow(TypeError);
  });

  it("throws on a path prefix not starting with a slash or a malformed method", () => {
    expect(() =>
      allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE, pathPrefix: "v1" }]),
    ).toThrow(TypeError);
    expect(() =>
      allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE, methods: ["BAD METHOD"] }]),
    ).toThrow(TypeError);
    expect(() =>
      allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE, methods: ["  "] }]),
    ).toThrow(TypeError);
  });

  it("throws when the injected clock is invalid at construction", () => {
    expect(() => new EgressAllowlist({ bindings: [], now: () => "not-an-instant" })).toThrow(TypeError);
    expect(() => new EgressAllowlist({ bindings: [], now: () => "2026-10-03 00:00:00" })).toThrow(TypeError);
  });
});

describe("H3-025: deny-by-default and typed denials", () => {
  it("denies every egress on an empty allowlist as an unregistered endpoint", () => {
    const decision = allowlistWith([]).decide({
      url: INFERENCE_ONE,
      providerClass: "inference-primary",
    });
    expect(decision.verdict).toBe("deny");
    if (decision.verdict === "deny") {
      expect(decision.code).toBe("unregistered_endpoint");
    }
  });

  it("denies an endpoint host that is not registered", () => {
    const decision = allowlistWith([{ providerClass: "inference-primary", endpoint: INFERENCE_ONE }]).decide({
      url: "https://other.provider-nine.invalid/v1",
      providerClass: "inference-primary",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "unregistered_endpoint" });
  });

  it("denies non-https schemes with a typed code", () => {
    const decision = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]).decide({
      url: "http://inference.provider-one.invalid/v1/x",
      providerClass: "p",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "non_https_scheme" });
  });

  it("denies URLs embedding credentials without echoing them", () => {
    const decision = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]).decide({
      url: "https://user:pw@inference.provider-one.invalid/v1/x",
      providerClass: "p",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "embedded_credentials" });
    if (decision.verdict === "deny") {
      expect(decision.reason).not.toContain("pw");
      expect(decision.reason).not.toContain("user:");
    }
  });

  it("denies an unparseable URL with a typed code", () => {
    const decision = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]).decide({
      url: "::not-a-url",
      providerClass: "p",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "unparseable_url" });
  });

  it("denies a registered endpoint bound to a different provider class", () => {
    const decision = allowlistWith([
      { providerClass: "inference-primary", endpoint: INFERENCE_ONE },
      { providerClass: "inference-secondary", endpoint: INFERENCE_TWO },
    ]).decide({
      url: INFERENCE_TWO,
      providerClass: "inference-primary",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "endpoint_not_bound_to_provider" });
  });

  it("denies a non-declared port on an otherwise registered host", () => {
    const decision = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]).decide({
      url: "https://inference.provider-one.invalid:8443/v1/x",
      providerClass: "p",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "unregistered_endpoint" });
  });

  it("permits a declared non-default port and denies the default on that binding", () => {
    const allowlist = allowlistWith([
      { providerClass: "p", endpoint: "https://inference.provider-three.invalid:8443/v1" },
    ]);
    expect(
      allowlist.decide({ url: "https://inference.provider-three.invalid:8443/v1/x", providerClass: "p" }),
    ).toMatchObject({ verdict: "allow", host: "inference.provider-three.invalid", port: "8443" });
    expect(
      allowlist.decide({ url: "https://inference.provider-three.invalid/v1/x", providerClass: "p" }),
    ).toMatchObject({ verdict: "deny", code: "unregistered_endpoint" });
  });

  it("denies paths outside every declared prefix", () => {
    const decision = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]).decide({
      url: "https://inference.provider-one.invalid/admin/keys",
      providerClass: "p",
    });
    expect(decision).toMatchObject({ verdict: "deny", code: "path_not_permitted" });
  });

  it("denies a method outside the declared method set", () => {
    const decision = allowlistWith([
      { providerClass: "p", endpoint: INFERENCE_ONE, methods: ["POST"] },
    ]).decide({ url: INFERENCE_ONE, method: "DELETE", providerClass: "p" });
    expect(decision).toMatchObject({ verdict: "deny", code: "method_not_permitted" });
  });

  it("denies malformed attempts (schema-invalid input) without throwing", () => {
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    // The cast is deliberate: this suite must also hold at the runtime
    // boundary for values that violate the declared types.
    const hostile = { url: 42, providerClass: "p" } as unknown as { url: string; providerClass: string };
    expect(allowlist.decide(hostile)).toMatchObject({ verdict: "deny", code: "invalid_request" });
    expect(
      allowlist.decide({ url: INFERENCE_ONE, providerClass: "   " }),
    ).toMatchObject({ verdict: "deny", code: "invalid_request" });
  });

  it("denies with a typed invalid_clock code when the injected clock breaks at runtime", () => {
    let broken = false;
    const allowlist = new EgressAllowlist({
      bindings: [{ providerClass: "p", endpoint: INFERENCE_ONE }],
      now: () => (broken ? "garbage" : T0),
    });
    broken = true;
    const decision = allowlist.decide({ url: INFERENCE_ONE, providerClass: "p" });
    expect(decision).toMatchObject({ verdict: "deny", code: "invalid_clock" });
    // Recovery after clock repair: same attempt now allows.
    broken = false;
    expect(allowlist.decide({ url: INFERENCE_ONE, providerClass: "p" }).verdict).toBe("allow");
  });
});

describe("H3-025: allow path, prefix and method matching", () => {
  const bindings = [
    { providerClass: "inference-primary", endpoint: INFERENCE_ONE },
    { providerClass: "inference-secondary", endpoint: INFERENCE_TWO, methods: ["POST"] },
  ];

  it("allows an exact declared endpoint path and normalizes method case", () => {
    const allowlist = allowlistWith(bindings);
    const decision = allowlist.decide({
      url: "https://inference.provider-one.invalid/v1",
      method: "get",
      providerClass: "inference-primary",
    });
    expect(decision).toMatchObject({
      verdict: "allow",
      providerClass: "inference-primary",
      scheme: "https",
      host: "inference.provider-one.invalid",
      port: "443",
      path: "/v1",
      method: "GET",
    });
  });

  it("allows deeper paths under the declared prefix (path equality or child paths)", () => {
    const allowlist = allowlistWith(bindings);
    expect(
      allowlist.decide({
        url: "https://inference.provider-one.invalid/v1/complete",
        method: "POST",
        providerClass: "inference-primary",
      }).verdict,
    ).toBe("allow");
    // A sibling path that merely shares a prefix STRING is not a child path.
    expect(
      allowlist.decide({
        url: "https://inference.provider-one.invalid/v1extra",
        providerClass: "inference-primary",
      }),
    ).toMatchObject({ verdict: "deny", code: "path_not_permitted" });
  });

  it("declares normalized endpoints for operator review", () => {
    const endpoints: readonly DeclaredEgressEndpoint[] = allowlistWith(bindings).declaredEndpoints();
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toMatchObject({
      providerClass: "inference-primary",
      scheme: "https",
      host: "inference.provider-one.invalid",
      port: "443",
      pathPrefix: "/v1",
    });
    expect(endpoints[1]).toMatchObject({ methods: ["POST"], pathPrefix: "/api" });
  });
});

describe("H3-025: composition with the model registry (read-only)", () => {
  it("allows egress only for a registry-allowed routing to the bound provider class", () => {
    const registry = registryWithTwoClasses();
    const allowlist = allowlistWith([
      { providerClass: "inference-primary", endpoint: INFERENCE_ONE },
      { providerClass: "inference-secondary", endpoint: INFERENCE_TWO },
    ]);
    const attempt = routedAllow(registry, "https://inference.provider-one.invalid/v1/complete");
    expect(allowlist.decideForRouting(attempt).verdict).toBe("allow");
  });

  it("denies egress when the registry denied the routing (fail closed, typed)", () => {
    const registry = registryWithTwoClasses();
    const allowlist = allowlistWith([{ providerClass: "inference-primary", endpoint: INFERENCE_ONE }]);

    const unregistered = registry.resolveModel({ purpose: "summarization", declaredModel: "core/ghost" });
    if (unregistered.decision !== "deny") throw new Error("fixture: expected registry deny");
    const denied = allowlist.decideForRouting({
      url: INFERENCE_ONE,
      routing: unregistered,
    });
    expect(denied).toMatchObject({
      verdict: "deny",
      code: "route_denied",
      routeCode: "unregistered_model",
    });

    const noRoute = registry.resolveModel({ purpose: "summarization", requirements: { minContextWindowTokens: 999_999 } });
    if (noRoute.decision !== "deny") throw new Error("fixture: expected registry deny");
    expect(allowlist.decideForRouting({ url: INFERENCE_ONE, routing: noRoute })).toMatchObject({
      verdict: "deny",
      code: "route_denied",
      routeCode: "no_routable_model",
    });
  });

  it("denies a registry-allowed routing whose provider class is not bound to the target endpoint", () => {
    const registry = registryWithTwoClasses();
    const allowlist = allowlistWith([{ providerClass: "inference-secondary", endpoint: INFERENCE_ONE }]);
    const attempt = routedAllow(registry, "https://inference.provider-one.invalid/v1/complete");
    expect(allowlist.decideForRouting(attempt)).toMatchObject({
      verdict: "deny",
      code: "endpoint_not_bound_to_provider",
    });
  });

  it("treats a malformed routing decision as an invalid request (no implicit allow)", () => {
    const allowlist = allowlistWith([{ providerClass: "inference-primary", endpoint: INFERENCE_ONE }]);
    const malformed = { noTypedDecision: true } as unknown as Parameters<
      typeof allowlist.decideForRouting
    >[0]["routing"];
    expect(
      allowlist.decideForRouting({ url: INFERENCE_ONE, routing: malformed }),
    ).toMatchObject({ verdict: "deny", code: "invalid_request" });
    // An object shaped like a decision but with an unrecognized verdict still
    // fails closed — never an implicit allow.
    const foreign = { decision: "maybe" } as unknown as Parameters<
      typeof allowlist.decideForRouting
    >[0]["routing"];
    expect(
      allowlist.decideForRouting({ url: INFERENCE_ONE, routing: foreign }),
    ).toMatchObject({ verdict: "deny", code: "route_denied" });
  });
});

describe("H3-025: guarded transport handoff", () => {
  it("never touches the transport on a denial", async () => {
    let calls = 0;
    const transport = async (): Promise<unknown> => {
      calls += 1;
      return "unreachable";
    };
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    const outcome = await allowlist.guardedFetch(
      { url: "https://other.provider-nine.invalid/v1", providerClass: "p" },
      transport,
    );
    expect(calls).toBe(0);
    expect(outcome.verdict).toBe("blocked");
    if (outcome.verdict === "blocked") {
      expect(outcome.decision.code).toBe("unregistered_endpoint");
    }
  });

  it("reaches the transport only on allow, with the original URL, and contains failures by name", async () => {
    const seen: string[] = [];
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);

    const completed: EgressOutcome = await allowlist.guardedFetch(
      { url: `${INFERENCE_ONE}/complete`, method: "POST", providerClass: "p" },
      async (url) => {
        seen.push(url);
        return { status: 200 };
      },
    );
    expect(seen).toEqual([`${INFERENCE_ONE}/complete`]);
    expect(completed.verdict).toBe("completed");

    const failed: EgressOutcome = await allowlist.guardedFetch(
      { url: `${INFERENCE_ONE}/complete`, method: "POST", providerClass: "p" },
      async () => {
        throw new Error("sensitive transport detail should never surface");
      },
    );
    expect(failed.verdict).toBe("failed");
    if (failed.verdict === "failed") {
      expect(failed.errorName).toBe("Error");
      expect("sensitive" in failed).toBe(false);
      expect(JSON.stringify(failed)).not.toContain("sensitive transport detail");
    }
  });

  it("resolves the default transport lazily; offline denial needs no transport at all", async () => {
    const allowlist = allowlistWith([]);
    const outcome = await allowlist.guardedFetch({ url: INFERENCE_ONE, providerClass: "p" });
    expect(outcome.verdict).toBe("blocked");
  });
});

describe("H3-025: audit ledger and secret hygiene", () => {
  it("audits every decision append-only with deterministic ids and no query material", () => {
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    allowlist.decide({ url: `${INFERENCE_ONE}/complete?key=SECRET-VALUE`, method: "POST", providerClass: "p" });
    allowlist.decide({ url: "https://other.provider-nine.invalid/v1", providerClass: "p" });

    const ledger: readonly EgressAuditRecord[] = allowlist.auditLog();
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({
      verdict: "allow",
      code: null,
      host: "inference.provider-one.invalid",
      path: "/v1/complete",
      method: "POST",
      at: T0,
    });
    expect(ledger[1]).toMatchObject({ verdict: "deny", code: "unregistered_endpoint" });
    expect(ledger[0].id).toMatch(/^egress-[0-9a-f]{8}$/);
    expect(ledger[1].id).toMatch(/^egress-[0-9a-f]{8}$/);

    const dump = JSON.stringify(ledger);
    expect(dump).not.toContain("SECRET-VALUE");
    expect(dump).not.toContain("?key");

    // Append-only: the returned array is a copy.
    expect(allowlist.auditLog()).not.toBe(ledger);
    allowlist.decide({ url: INFERENCE_ONE, providerClass: "p" });
    expect(allowlist.auditLog()).toHaveLength(3);
  });

  it("produces identical decisions and audit ids for identical inputs (determinism)", () => {
    const first = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    const second = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    const attempt = { url: `${INFERENCE_ONE}/complete`, method: "POST", providerClass: "p" };
    const a = first.decide(attempt);
    const b = second.decide(attempt);
    expect(a).toEqual(b);
    expect(first.auditLog()[0]?.id).toBe(second.auditLog()[0]?.id);
  });

  it("never mutates the caller's attempt input", () => {
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    const attempt = { url: `${INFERENCE_ONE}/complete`, method: "post", providerClass: "p" };
    const snapshot = JSON.stringify(attempt);
    allowlist.decide(attempt);
    expect(JSON.stringify(attempt)).toBe(snapshot);
  });
});

describe("H3-025: typed surface", () => {
  it("exposes a discriminated decision and outcome union", () => {
    const allowlist = allowlistWith([{ providerClass: "p", endpoint: INFERENCE_ONE }]);
    const decision: EgressDecision = allowlist.decide({
      url: INFERENCE_ONE,
      providerClass: "p",
    });
    expectTypeOf(decision.verdict).toEqualTypeOf<"allow" | "deny">();
    expectTypeOf<EgressDecision>().toExtend<
      { verdict: "allow" } | { verdict: "deny"; code: string; reason: string }
    >();
    expectTypeOf<EgressOutcome>().toExtend<
      { verdict: "blocked" } | { verdict: "completed" } | { verdict: "failed" }
    >();
  });
});
