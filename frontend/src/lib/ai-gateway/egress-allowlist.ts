/**
 * CoreGrid — runtime egress allowlist enforcement at the AI-gateway
 * boundary (H3 C-025 / L-T-007; Constitution §20 gateway-owned egress,
 * §25 provider neutrality, §16 typed decisions, §29 auditability).
 *
 * PURE enforcement module: no environment reads, no implicit network. The
 * only place a provider endpoint can be reached is through the guarded
 * transport handoff below (`guardedFetch`); every other consumer receives
 * typed decisions, never a socket.
 *
 * Design laws honored here:
 * - Deny-by-default: NOTHING egresses unless an operator declared the
 *   endpoint for the specific provider class. An empty allowlist denies
 *   everything; an unregistered endpoint is a typed denial, never a guess.
 * - Composition, not duplication: egress is permitted only for an invocation
 *   the model registry actually routed (`decideForRouting`). A registry deny
 *   is an egress deny — the allowlist never re-routes, it consumes the
 *   registry's typed decision (registry module is imported read-only).
 * - Fail-closed: malformed endpoint declarations (non-https, embedded
 *   credentials, non-host names, duplicate declarations) throw at
 *   construction; a broken allowlist can never silently permit egress.
 * - Secret hygiene: audit records carry scheme/host/port/path/method only —
 *   never query strings, fragments, headers, or bodies (§29).
 * - Purity/determinism: injected clock and transport; identical inputs
 *   produce identical decisions and audit ids.
 */

import { z } from "zod";
import type { ModelRoutingDecision } from "./model-registry";

/** Operator-declared binding of a provider class to a provider endpoint. */
export interface EgressBindingInput {
  /** Logical provider class (vendor-neutral, §25) the endpoint serves. */
  providerClass: string;
  /** Declared endpoint base URL (https only, no credentials, no query). */
  endpoint: string;
  /** Optional path constraint; defaults to the endpoint's own path. */
  pathPrefix?: string;
  /** Optional permitted HTTP methods; defaults to any method. */
  methods?: readonly string[];
}

/** Normalized, validated form of a declared egress endpoint. */
export interface DeclaredEgressEndpoint {
  providerClass: string;
  scheme: "https";
  host: string;
  port: string;
  pathPrefix: string;
  methods: readonly string[];
}

/** One egress attempt evaluated against one provider class. */
export interface EgressAttempt {
  url: string;
  method?: string;
  providerClass: string;
}

/** One egress attempt whose authority comes from a registry routing decision. */
export interface RoutedEgressAttempt {
  url: string;
  method?: string;
  routing: ModelRoutingDecision;
}

export type EgressDenyCode =
  | "invalid_request"
  | "invalid_clock"
  | "unparseable_url"
  | "non_https_scheme"
  | "embedded_credentials"
  | "unregistered_endpoint"
  | "endpoint_not_bound_to_provider"
  | "port_not_permitted"
  | "path_not_permitted"
  | "method_not_permitted"
  | "route_denied";

export type EgressDecision =
  | {
      verdict: "allow";
      providerClass: string;
      scheme: "https";
      host: string;
      port: string;
      path: string;
      method: string;
    }
  | {
      verdict: "deny";
      code: EgressDenyCode;
      reason: string;
      /** Registry deny code, present only for `route_denied`. */
      routeCode?: string;
    };

/** Transport handoff: the ONLY channel through which egress actually happens. */
export type EgressTransport = (url: string, init?: RequestInit) => Promise<unknown>;

export type EgressOutcome =
  | { verdict: "blocked"; decision: EgressDecision & { verdict: "deny" } }
  | { verdict: "completed"; decision: EgressDecision & { verdict: "allow" }; result: unknown }
  /** Transport failure; contained by error NAME only — never message or body. */
  | { verdict: "failed"; decision: EgressDecision & { verdict: "allow" }; errorName: string };

/** Audit record: append-only, deterministic id, secret-free by construction. */
export interface EgressAuditRecord {
  id: string;
  at: string;
  verdict: "allow" | "deny";
  code: EgressDenyCode | null;
  routeCode: string | null;
  providerClass: string | null;
  scheme: string;
  host: string;
  port: string;
  path: string;
  method: string;
}

const EgressAttemptSchema = z.object({
  url: z.string(),
  method: z.string().optional(),
  providerClass: z.string(),
});

const EgressBindingSchema = z.object({
  providerClass: z.string(),
  endpoint: z.string(),
  pathPrefix: z.string().optional(),
  methods: z.array(z.string()).optional(),
});

const RoutedTargetSchema = z.object({
  url: z.string(),
  method: z.string().optional(),
});

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const METHOD_PATTERN = /^[A-Z][A-Z0-9!#$%&'*+\-.^_`|~]*$/;

function isIsoInstant(value: string): boolean {
  if (!ISO_INSTANT_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function requireNonEmpty(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`EgressAllowlist.${name} must be a non-empty string`);
  }
  return trimmed;
}

/**
 * A host is permitted as an endpoint name only if it is a registrable,
 * non-local DNS name: no IP literals (v4/v6), no localhost forms, no
 * single-label names. This keeps the allowlist to provider endpoints.
 */
function isPermittedEndpointHost(host: string): boolean {
  if (host.length === 0) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.includes(":")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.includes(".");
}

interface ParsedEndpoint {
  scheme: "https";
  host: string;
  port: string;
  path: string;
}

function normalizePort(port: string): string {
  return port === "" ? "443" : port;
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return normalizePath(path.slice(0, -1));
  }
  return path;
}

function parseEndpointUrl(name: string, rawUrl: string): ParsedEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new TypeError(`EgressAllowlist.${name} is not a parseable URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError(`EgressAllowlist.${name} must be an https endpoint`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new TypeError(`EgressAllowlist.${name} must not embed credentials`);
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new TypeError(`EgressAllowlist.${name} must not carry a query or fragment`);
  }
  const host = parsed.hostname.replace(/\.$/, "");
  if (!isPermittedEndpointHost(host)) {
    throw new TypeError(
      `EgressAllowlist.${name} must be a registrable provider host (no IP literals, localhost or single-label names)`,
    );
  }
  return {
    scheme: "https",
    host,
    port: normalizePort(parsed.port),
    path: normalizePath(parsed.pathname),
  };
}

function pathMatches(prefix: string, path: string): boolean {
  if (prefix === "/") return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Deterministic FNV-1a id over secret-free audit fields. */
function auditId(record: Omit<EgressAuditRecord, "id">): string {
  const material = [
    record.at,
    record.verdict,
    record.code ?? "-",
    record.routeCode ?? "-",
    record.providerClass ?? "-",
    record.scheme,
    record.host,
    record.port,
    record.path,
    record.method,
  ].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `egress-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * The runtime egress allowlist. Operator-declared provider endpoints, typed
 * deny-by-default decisions, and a guarded transport handoff so the gateway
 * process is the only place a provider endpoint can be reached.
 */
export class EgressAllowlist {
  private readonly bindings: DeclaredEgressEndpoint[] = [];
  private readonly ledger: EgressAuditRecord[] = [];
  private readonly now: () => string;

  constructor(config: {
    bindings?: readonly EgressBindingInput[];
    /** Injected clock returning ISO-8601 instants. Defaults to system time. */
    now?: () => string;
  }) {
    const clock = config.now ?? (() => new Date().toISOString());
    const probe = (() => {
      try {
        return clock();
      } catch {
        return undefined;
      }
    })();
    if (typeof probe !== "string" || !isIsoInstant(probe)) {
      throw new TypeError("EgressAllowlist.now must return a valid ISO-8601 instant");
    }
    this.now = clock;

    if (config.bindings !== undefined && !Array.isArray(config.bindings)) {
      throw new TypeError("EgressAllowlist.bindings must be an array");
    }
    for (const raw of config.bindings ?? []) {
      this.bindings.push(this.validateBinding(raw));
    }
    const seen = new Set<string>();
    for (const binding of this.bindings) {
      const key = [
        binding.providerClass,
        binding.host,
        binding.port,
        binding.pathPrefix,
      ].join("|");
      if (seen.has(key)) {
        throw new TypeError(
          `EgressAllowlist declares duplicate endpoint binding "${key}"`,
        );
      }
      seen.add(key);
    }
  }

  private validateBinding(raw: EgressBindingInput): DeclaredEgressEndpoint {
    const shaped = EgressBindingSchema.safeParse(raw);
    if (!shaped.success) {
      throw new TypeError("EgressAllowlist.bindings[] failed schema validation");
    }
    const providerClass = requireNonEmpty("bindings[].providerClass", shaped.data.providerClass);
    const endpoint = parseEndpointUrl("bindings[].endpoint", shaped.data.endpoint);
    const pathPrefix = normalizePath(
      requireNonEmpty("bindings[].pathPrefix", shaped.data.pathPrefix ?? endpoint.path),
    );
    if (!pathPrefix.startsWith("/")) {
      throw new TypeError(`EgressAllowlist.bindings[${providerClass}].pathPrefix must start with "/"`);
    }
    const methods = (shaped.data.methods ?? []).map((method) => {
      const upper = requireNonEmpty("bindings[].methods[]", method).toUpperCase();
      if (!METHOD_PATTERN.test(upper)) {
        throw new TypeError(`EgressAllowlist.bindings[${providerClass}] has a malformed method "${upper}"`);
      }
      return upper;
    });
    return {
      providerClass,
      scheme: "https",
      host: endpoint.host,
      port: endpoint.port,
      pathPrefix,
      methods,
    };
  }

  /** Operator-facing inventory of declared endpoints (observability, §29). */
  declaredEndpoints(): readonly DeclaredEgressEndpoint[] {
    return this.bindings.map((binding) => ({ ...binding, methods: [...binding.methods] }));
  }

  /** Append-only audit ledger; records never carry query strings or bodies. */
  auditLog(): readonly EgressAuditRecord[] {
    return [...this.ledger];
  }

  private audit(decision: EgressDecision, parts: {
    providerClass: string | null;
    scheme: string;
    host: string;
    port: string;
    path: string;
    method: string;
  }): void {
    const at = this.now();
    if (!isIsoInstant(at)) {
      // A broken clock cannot be audited truthfully; the denial itself still
      // stands. Record with a redacted instant marker rather than a lie.
      this.ledger.push({
        id: auditId({ ...parts, at: "invalid-clock", verdict: "deny", code: "invalid_clock", routeCode: null }),
        at: "invalid-clock",
        verdict: "deny",
        code: "invalid_clock",
        routeCode: null,
        ...parts,
      });
      return;
    }
    const record: EgressAuditRecord =
      decision.verdict === "allow"
        ? {
            id: "",
            at,
            verdict: "allow",
            code: null,
            routeCode: null,
            providerClass: decision.providerClass,
            scheme: decision.scheme,
            host: decision.host,
            port: decision.port,
            path: decision.path,
            method: decision.method,
          }
        : {
            id: "",
            at,
            verdict: "deny",
            code: decision.code,
            routeCode: decision.routeCode ?? null,
            providerClass: parts.providerClass,
            scheme: parts.scheme,
            host: parts.host,
            port: parts.port,
            path: parts.path,
            method: parts.method,
          };
    record.id = auditId(record);
    this.ledger.push(record);
  }

  private evaluateUrl(rawUrl: string): ParsedEndpoint | EgressDecision {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return {
        verdict: "deny",
        code: "unparseable_url",
        reason: "Egress denied: target URL is not parseable",
      };
    }
    if (parsed.protocol !== "https:") {
      return {
        verdict: "deny",
        code: "non_https_scheme",
        reason: `Egress denied: scheme "${parsed.protocol.replace(/:$/, "")}" is not permitted (https only)`,
      };
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return {
        verdict: "deny",
        code: "embedded_credentials",
        reason: "Egress denied: target URL embeds credentials",
      };
    }
    const host = parsed.hostname.replace(/\.$/, "");
    if (!isPermittedEndpointHost(host)) {
      return {
        verdict: "deny",
        code: "unregistered_endpoint",
        reason: "Egress denied: target host is not a registrable endpoint name",
      };
    }
    return {
      scheme: "https",
      host,
      port: normalizePort(parsed.port),
      path: parsed.pathname,
    };
  }

  /**
   * Decide one egress attempt against the declared allowlist for a provider
   * class. Deny-by-default: any mismatch is a typed denial (fail closed).
   */
  decide(attempt: EgressAttempt): EgressDecision {
    const shaped = EgressAttemptSchema.safeParse(attempt);
    if (!shaped.success) {
      return { verdict: "deny", code: "invalid_request", reason: "Egress denied: malformed egress attempt" };
    }
    const method = (shaped.data.method ?? "GET").trim().toUpperCase() || "GET";
    const providerClass = shaped.data.providerClass.trim();
    if (providerClass.length === 0) {
      return {
        verdict: "deny",
        code: "invalid_request",
        reason: "Egress denied: provider class is required for egress",
      };
    }
    if (!isIsoInstant(this.now())) {
      const decision: EgressDecision = {
        verdict: "deny",
        code: "invalid_clock",
        reason: "Egress denied: injected clock did not return a valid ISO-8601 instant",
      };
      this.audit(decision, { providerClass, scheme: "", host: "", port: "", path: "", method });
      return decision;
    }

    const evaluated = this.evaluateUrl(shaped.data.url);
    if ("verdict" in evaluated) {
      this.audit(evaluated, { providerClass, scheme: "", host: "", port: "", path: "", method });
      return evaluated;
    }

    const onHost = this.bindings.filter(
      (binding) => binding.host === evaluated.host && binding.port === evaluated.port,
    );
    if (onHost.length === 0) {
      const decision: EgressDecision = {
        verdict: "deny",
        code: "unregistered_endpoint",
        reason: `Egress denied: endpoint "${evaluated.host}:${evaluated.port}" is not registered in the egress allowlist`,
      };
      this.audit(decision, { providerClass, ...evaluated, method });
      return decision;
    }
    const bound = onHost.filter((binding) => binding.providerClass === providerClass);
    if (bound.length === 0) {
      const decision: EgressDecision = {
        verdict: "deny",
        code: "endpoint_not_bound_to_provider",
        reason: `Egress denied: endpoint "${evaluated.host}:${evaluated.port}" is registered but not bound to provider class "${providerClass}"`,
      };
      this.audit(decision, { providerClass, ...evaluated, method });
      return decision;
    }
    if (!bound.some((binding) => binding.methods.length === 0 || binding.methods.includes(method))) {
      const decision: EgressDecision = {
        verdict: "deny",
        code: "method_not_permitted",
        reason: `Egress denied: method ${method} is not permitted on "${evaluated.host}:${evaluated.port}"`,
      };
      this.audit(decision, { providerClass, ...evaluated, method });
      return decision;
    }
    if (!bound.some((binding) => pathMatches(binding.pathPrefix, evaluated.path))) {
      const decision: EgressDecision = {
        verdict: "deny",
        code: "path_not_permitted",
        reason: `Egress denied: path "${evaluated.path}" is outside every declared prefix for "${evaluated.host}:${evaluated.port}"`,
      };
      this.audit(decision, { providerClass, ...evaluated, method });
      return decision;
    }

    const decision: EgressDecision = {
      verdict: "allow",
      providerClass,
      scheme: evaluated.scheme,
      host: evaluated.host,
      port: evaluated.port,
      path: evaluated.path,
      method,
    };
    this.audit(decision, { providerClass, ...evaluated, method });
    return decision;
  }

  /**
   * Composition point with the model registry (read-only): egress is
   * permitted only when the registry ALLOWED the invocation and the target
   * endpoint is declared for the routed provider class. A registry deny is
   * an egress deny — the allowlist never re-routes.
   */
  decideForRouting(attempt: RoutedEgressAttempt): EgressDecision {
    const shaped = RoutedTargetSchema.safeParse(attempt);
    if (!shaped.success) {
      return { verdict: "deny", code: "invalid_request", reason: "Egress denied: malformed routed egress attempt" };
    }
    const routing = attempt.routing;
    if (
      routing === null ||
      typeof routing !== "object" ||
      !("decision" in routing) ||
      typeof routing.decision !== "string"
    ) {
      return { verdict: "deny", code: "invalid_request", reason: "Egress denied: routed egress attempt carries no typed routing decision" };
    }
    if (routing.decision !== "allow") {
      const registryCode =
        "code" in routing && typeof routing.code === "string" ? routing.code : "unavailable";
      const decision: EgressDecision = {
        verdict: "deny",
        code: "route_denied",
        routeCode: registryCode,
        reason: `Egress denied: the model registry denied the invocation (${registryCode})`,
      };
      this.audit(decision, { providerClass: null, scheme: "", host: "", port: "", path: "", method: (shaped.data.method ?? "GET").trim().toUpperCase() || "GET" });
      return decision;
    }
    const providerClass =
      "providerClass" in routing && typeof routing.providerClass === "string"
        ? routing.providerClass
        : "";
    if (providerClass.length === 0) {
      return { verdict: "deny", code: "invalid_request", reason: "Egress denied: routed decision carries no provider class" };
    }
    return this.decide({ url: shaped.data.url, method: shaped.data.method, providerClass });
  }

  /**
   * The guarded transport handoff: egress happens ONLY here, ONLY on an
   * allow decision, ONLY through the injected (or platform) transport. A
   * denial never touches the transport.
   */
  async guardedFetch(
    attempt: EgressAttempt,
    transport?: EgressTransport,
  ): Promise<EgressOutcome> {
    const decision = this.decide(attempt);
    if (decision.verdict === "deny") {
      return { verdict: "blocked", decision };
    }
    const send: EgressTransport =
      transport ?? ((url, init) => globalThis.fetch(url, init));
    try {
      const result = await send(attempt.url, { method: decision.method });
      return { verdict: "completed", decision, result };
    } catch (error) {
      return {
        verdict: "failed",
        decision,
        errorName: error instanceof Error ? error.name : "unknown",
      };
    }
  }
}
