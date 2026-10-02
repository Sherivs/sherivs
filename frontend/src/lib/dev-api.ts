/**
 * CoreGrid Developer Platform — API platform and schema domain.
 *
 * Implements `architecture/phase-28-developer-platform.md`:
 * - API catalog (22): discoverable API catalog.
 * - API documentation (23): every public API includes purpose, authentication
 *   requirements, authorization, request schema, response schema, errors,
 *   rate limits, examples, version, lifecycle status.
 * - API styles (O): REST, GraphQL, event APIs, WebSockets, streaming APIs,
 *   internal RPC where appropriate.
 * - API versioning (24-25): explicit versioning; breaking changes require
 *   controlled migration paths.
 * - API explorer (26): inspect endpoints, construct requests, provide test
 *   parameters, execute requests, inspect responses/headers/errors within
 *   authorized sandbox environments.
 * - Schema registry (41): versioned schemas. Schema compatibility (42):
 *   detect breaking changes.
 * - Data contract development (AJ): products declare data consumed, data
 *   produced, transformations, retention, sensitivity.
 * - API discoverability (FW): developers discover capabilities programmatically;
 *   machine-readable platform catalog (FX).
 *
 * Phase 28 provides the developer-facing API contracts; it does not replace the
 * authoritative domain subsystems those APIs expose (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ApiEndpointId = string & { readonly __brand: "ApiEndpointId" };
export type SchemaVersionId = string & { readonly __brand: "SchemaVersionId" };
export type DataContractId = string & { readonly __brand: "DataContractId" };

export function apiEndpointId(raw: string): ApiEndpointId {
  return raw as ApiEndpointId;
}
export function schemaVersionId(raw: string): SchemaVersionId {
  return raw as SchemaVersionId;
}
export function dataContractId(raw: string): DataContractId {
  return raw as DataContractId;
}

/* ─────────────────────────────────────────────────────────────
 * API styles (Section O)
 * ────────────────────────────────────────────────────────────*/

export type ApiStyle = "rest" | "graphql" | "event" | "websocket" | "streaming" | "internal_rpc";

export const API_STYLES: readonly ApiStyle[] = [
  "rest",
  "graphql",
  "event",
  "websocket",
  "streaming",
  "internal_rpc",
] as const;

/* ─────────────────────────────────────────────────────────────
 * API catalog + documentation (Sections 22, 23)
 * ────────────────────────────────────────────────────────────*/

export type ApiLifecycleStatus = "proposed" | "beta" | "stable" | "deprecated" | "sunset";

export const API_LIFECYCLE_STATUSES: readonly ApiLifecycleStatus[] = [
  "proposed",
  "beta",
  "stable",
  "deprecated",
  "sunset",
] as const;

export interface ApiEndpoint {
  id: ApiEndpointId;
  /** e.g. "GET /v1/students/{id}". */
  path: string;
  style: ApiStyle;
  version: string;
  /** Domain the API exposes, e.g. "education", "finance". */
  domain: string;
  purpose: string;
  /** Authentication requirements (Section 23). */
  authenticationRequired: boolean;
  /** Authorization scope description. */
  authorization: string;
  requestSchemaRef: string;
  responseSchemaRef: string;
  errorSchemaRef: string;
  rateLimitPerMinute: number;
  examples: string[];
  lifecycleStatus: ApiLifecycleStatus;
  /** SDK languages with generated bindings. */
  sdkLanguages: string[];
}

export function registerApiEndpoint(input: {
  id: ApiEndpointId;
  path: string;
  style: ApiStyle;
  version: string;
  domain: string;
  purpose: string;
  authenticationRequired?: boolean;
  authorization?: string;
  requestSchemaRef?: string;
  responseSchemaRef?: string;
  errorSchemaRef?: string;
  rateLimitPerMinute?: number;
  examples?: string[];
  lifecycleStatus?: ApiLifecycleStatus;
  sdkLanguages?: string[];
}): { ok: true; endpoint: ApiEndpoint } | { ok: false; error: string } {
  if (!input.path.trim()) {
    return { ok: false, error: "API endpoint path is required" };
  }
  if (!input.version.trim()) {
    return { ok: false, error: "API endpoint version is required (Section 24)" };
  }
  if (!input.purpose.trim()) {
    return { ok: false, error: "API documentation requires a purpose (Section 23)" };
  }
  return {
    ok: true,
    endpoint: {
      id: input.id,
      path: input.path,
      style: input.style,
      version: input.version,
      domain: input.domain,
      purpose: input.purpose,
      authenticationRequired: input.authenticationRequired ?? true,
      authorization: input.authorization ?? "",
      requestSchemaRef: input.requestSchemaRef ?? "",
      responseSchemaRef: input.responseSchemaRef ?? "",
      errorSchemaRef: input.errorSchemaRef ?? "",
      rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      examples: input.examples ?? [],
      lifecycleStatus: input.lifecycleStatus ?? "proposed",
      sdkLanguages: input.sdkLanguages ?? [],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * API versioning (Sections 24, 25)
 * ────────────────────────────────────────────────────────────*/

export type ApiChangeKind = "breaking" | "additive" | "fix";

export const API_CHANGE_KINDS: readonly ApiChangeKind[] = ["breaking", "additive", "fix"] as const;

export interface ApiChange {
  kind: ApiChangeKind;
  description: string;
}

/**
 * Breaking changes require controlled migration paths (Section 25). A breaking
 * change is permitted only when a migration plan exists and the old version
 * remains supported during the transition.
 */
export function canApplyBreakingApiChange(input: {
  change: ApiChange;
  migrationPlanRef: string | null;
  previousVersionSupported: boolean;
  deprecated: boolean;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.change.kind !== "breaking") {
    return { allowed: true, reasons };
  }
  if (!input.migrationPlanRef)
    reasons.push("Breaking change requires a migration plan (Section 25)");
  if (!input.previousVersionSupported)
    reasons.push("Previous API version must remain supported during migration");
  if (!input.deprecated) reasons.push("API must be deprecated before breaking change");
  return { allowed: reasons.length === 0, reasons };
}

/* ─────────────────────────────────────────────────────────────
 * API explorer (Section 26)
 * ────────────────────────────────────────────────────────────*/

export interface ApiExplorerRequest {
  endpointId: ApiEndpointId;
  method: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  /** Explorer requests only run inside authorized sandbox environments (26). */
  environment: "sandbox" | "development";
}

export function createApiExplorerRequest(input: {
  endpointId: ApiEndpointId;
  method: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  environment?: ApiExplorerRequest["environment"];
}): { ok: true; request: ApiExplorerRequest } | { ok: false; error: string } {
  if (!input.method.trim()) {
    return { ok: false, error: "Explorer request requires an HTTP method" };
  }
  if (input.environment === "development") {
    return { ok: false, error: "API explorer is restricted to sandbox environments (Section 26)" };
  }
  return {
    ok: true,
    request: {
      endpointId: input.endpointId,
      method: input.method,
      pathParams: input.pathParams ?? {},
      queryParams: input.queryParams ?? {},
      headers: input.headers ?? {},
      body: input.body ?? "",
      environment: input.environment ?? "sandbox",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Schema registry (41) + compatibility (42)
 * ────────────────────────────────────────────────────────────*/

export interface SchemaVersion {
  id: SchemaVersionId;
  schemaKey: string;
  version: number;
  /** Required field names for this schema version. */
  requiredFields: string[];
  /** Optional field names. */
  optionalFields: string[];
  /** Producer ref. */
  producerRef: string;
  publishedAt: string;
}

export function publishSchemaVersion(input: {
  id: SchemaVersionId;
  schemaKey: string;
  version: number;
  requiredFields: string[];
  optionalFields?: string[];
  producerRef: string;
  now?: string;
}): SchemaVersion {
  return {
    id: input.id,
    schemaKey: input.schemaKey,
    version: input.version,
    requiredFields: input.requiredFields,
    optionalFields: input.optionalFields ?? [],
    producerRef: input.producerRef,
    publishedAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * Schema compatibility (Section 42): a new version is backward-compatible when it
 * does not remove previously-required fields. Removing a required field is a
 * breaking change.
 */
export function isSchemaBackwardCompatible(previous: SchemaVersion, next: SchemaVersion): boolean {
  return previous.requiredFields.every((f) => next.requiredFields.includes(f));
}

/* ─────────────────────────────────────────────────────────────
 * Data contracts (Section AJ)
 * ────────────────────────────────────────────────────────────*/

export interface DataContract {
  id: DataContractId;
  projectRef: string;
  /** Data consumed. */
  dataConsumed: string[];
  /** Data produced. */
  dataProduced: string[];
  /** Transformations applied. */
  transformations: string[];
  retentionDays: number;
  sensitivity: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
}

export function createDataContract(input: {
  id: DataContractId;
  projectRef: string;
  dataConsumed?: string[];
  dataProduced?: string[];
  transformations?: string[];
  retentionDays?: number;
  sensitivity?: DataContract["sensitivity"];
}): DataContract {
  return {
    id: input.id,
    projectRef: input.projectRef,
    dataConsumed: input.dataConsumed ?? [],
    dataProduced: input.dataProduced ?? [],
    transformations: input.transformations ?? [],
    retentionDays: input.retentionDays ?? 0,
    sensitivity: input.sensitivity ?? "TENANT_INTERNAL",
  };
}
