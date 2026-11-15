/**
 * Connector adapter contract (ENGINE-06, ADR-084).
 *
 * An adapter PERFORMS a tool call that the broker has already cleared. It never
 * decides, never reads the ledger, never resolves its own secret, and never
 * talks to the network except through the injected HTTP port. Everything it
 * needs arrives in `AdapterCall`; everything it returns is a bounded, redacted
 * summary.
 */
import type { ConnectorBinding } from "../tool-broker/connector-vault";
import type { ToolDefinition } from "../tool-broker/tool-contract";

export interface HttpRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

/** The only network seam. Implementations must not follow redirects. */
export interface HttpPort {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface SecretResolverPort {
  /** Returns the secret for a vault reference, or null. The value lives in memory only. */
  resolve(secretRef: string): Promise<string | null>;
}

export interface AdapterCall {
  readonly tool: ToolDefinition;
  readonly args: Readonly<Record<string, unknown>>;
  readonly binding: ConnectorBinding;
  readonly secret: string;
  readonly http: HttpPort;
  readonly idempotencyKey: string;
}

export type AdapterErrorCode =
  | "invalid_args"
  | "unsupported_operation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "bad_response"
  | "egress_blocked";

export type AdapterResult =
  | { readonly outcome: "succeeded"; readonly summary: unknown }
  | { readonly outcome: "failed"; readonly code: AdapterErrorCode };

export interface ConnectorAdapter {
  readonly connector: string;
  /** Tool ids this adapter may perform. Anything else is refused by the gate. */
  readonly tools: readonly string[];
  execute(call: AdapterCall): Promise<AdapterResult>;
}
