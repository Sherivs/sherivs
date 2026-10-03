/**
 * CoreGrid Mobile — normalized error taxonomy (Phase 22 AE: error
 * management). Every transport/vendor failure is mapped onto one closed
 * kind set so screens render honest, non-sensitive error states without
 * leaking backend details (§29).
 */
export type ApiErrorKind =
  | "network"
  | "timeout"
  | "offline"
  | "auth"
  | "authorization"
  | "validation"
  | "not_configured"
  | "server"
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "authorization";
  if (status === 404) return "not_configured";
  if (status === 400 || status === 422) return "validation";
  if (status === 429) return "server";
  if (status >= 500) return "server";
  return "unknown";
}

/** Map a Supabase/Postgrest failure onto the closed taxonomy. */
export function fromSupabaseError(error: { message: string; code?: string } | null): ApiError {
  if (!error) return new ApiError("unknown", "unknown database error");
  const message = error.message;
  const code = error.code ?? "";
  if (code === "PGRST301" || /jwt|token|unauthorized|invalid login credentials/i.test(message)) {
    return new ApiError("auth", message);
  }
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return new ApiError("authorization", "access denied by server-side authorization");
  }
  if (code === "PGRST116") {
    return new ApiError("not_configured", "the requested record does not exist or is not visible");
  }
  if (/Failed to fetch|NetworkError|network/i.test(message)) {
    return new ApiError("network", "network request failed");
  }
  return new ApiError("server", message);
}

/** Human-presentable, non-sensitive headline per error kind. */
export function errorHeadline(kind: ApiErrorKind): string {
  switch (kind) {
    case "network":
      return "CoreGrid could not be reached";
    case "offline":
      return "You are offline";
    case "timeout":
      return "The request timed out";
    case "auth":
      return "Your session is not valid";
    case "authorization":
      return "You are not authorized for this view";
    case "validation":
      return "The server rejected the request";
    case "not_configured":
      return "This capability is not configured in this environment";
    case "server":
      return "The CoreGrid server reported an error";
    case "unknown":
      return "Something went wrong";
  }
}