/**
 * CoreGrid Mobile — TanStack Start server-function URL contract client.
 *
 * Contract (verified against the live exerciser
 * `scripts/exercise-foundation-loop.mjs`, the repository's HTTP evidence
 * for server-function calls):
 *
 *   POST {EXPO_PUBLIC_COREGRID_WEB_BASE_URL}/_serverFn/{serverFunctionId}
 *   Headers:
 *     Authorization: Bearer <supabase access token>
 *     Content-Type: application/json
 *     x-tsr-serverFn: true
 *   Body: {"data": <request payload>}
 *
 * The server-function id is a build-generated content hash emitted by the
 * deployed web build; ids are supplied per environment via EXPO_PUBLIC_*
 * variables. An unset id for a named contract fails closed with an
 * explicit configuration error — the client never guesses a URL.
 *
 * GET server functions carry their input in the `input` query parameter
 * (JSON-encoded). This serialization is the one documented caveat of this
 * layer: it must be confirmed against the deployed web build when the
 * first GET contract goes live (the repository's live evidence covers the
 * POST shape only). POST is the contract used by write paths.
 */
import type { MobileEnv } from "./contracts/env";
import { ApiError } from "./errors";

export const SERVER_FN_URL_CONTRACT = {
  /** Route prefix registered by the TanStack Start server. */
  routePrefix: "/_serverFn",
  /** Marker header required by the server-function RPC handler. */
  markerHeader: "x-tsr-serverFn",
} as const;

/** Names of the server-function contracts mobile consumes. */
export type ServerFnName = "recordFoundationLoop" | "listIdentities";

export interface ServerFnCaller {
  readonly env: MobileEnv;
  /** The actor's Supabase access token; the server gate authenticates on it. */
  readonly accessToken: string | null;
  /** Injectable transport (tests pass a stub; the app uses global fetch). */
  readonly fetchImpl?: typeof fetch;
}

export function serverFnUrl(env: MobileEnv, id: string): string {
  return `${env.coregridWebBaseUrl}${SERVER_FN_URL_CONTRACT.routePrefix}/${id}`;
}

export function serverFnIdFor(env: MobileEnv, name: ServerFnName): string {
  const id = env.serverFnIds[name];
  if (!id) {
    throw new ApiError(
      "not_configured",
      `server-function id for "${name}" is not configured in this environment`,
    );
  }
  return id;
}

function decodeResponse<TResponse>(text: string): TResponse {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new ApiError("server", "server-function response was not valid JSON");
  }
  if (decoded !== null && typeof decoded === "object" && "error" in decoded) {
    const error = (decoded as { error?: { message?: unknown } }).error;
    const message = typeof error?.message === "string" ? error.message : "server-function error";
    throw new ApiError("server", message);
  }
  if (
    decoded !== null &&
    typeof decoded === "object" &&
    "result" in decoded
  ) {
    return (decoded as { result: TResponse }).result;
  }
  return decoded as TResponse;
}

export async function invokeServerFn<TResponse>(
  caller: ServerFnCaller,
  name: ServerFnName,
  input?: unknown,
): Promise<TResponse> {
  const id = serverFnIdFor(caller.env, name);
  const fetchImpl = caller.fetchImpl ?? fetch;
  const url = new URL(serverFnUrl(caller.env, id));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [SERVER_FN_URL_CONTRACT.markerHeader]: "true",
  };
  if (caller.accessToken) {
    headers.Authorization = `Bearer ${caller.accessToken}`;
  }

  let response: Response;
  try {
    if (name === "listIdentities") {
      if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
      response = await fetchImpl(url, { method: "GET", headers });
    } else {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ data: input ?? {} }),
      });
    }
  } catch (error) {
    throw new ApiError("network", "server-function request failed to send", null, error);
  }

  if (!response.ok) {
    const kind =
      response.status === 401
        ? "auth"
        : response.status === 403
          ? "authorization"
          : response.status >= 500
            ? "server"
            : "unknown";
    throw new ApiError(kind, `server-function call failed with HTTP ${response.status}`, response.status);
  }

  return decodeResponse<TResponse>(await response.text());
}