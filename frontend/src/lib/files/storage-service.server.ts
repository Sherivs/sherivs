/**
 * CoreGrid — service-role storage client factory (MISSION-R-103, V1CAP-0xx).
 *
 * Composition root for Supabase Storage access through the tenant-scoped
 * adapter (`storage-adapter.server.ts`) under service-role credentials.
 * The adapter owns the tenant-path convention and the failure policy; this
 * factory owns ONE thing: failing closed unless a genuine service-role
 * configuration is present.
 *
 * Fail-closed rules:
 * - Missing URL or key is an explicit deny, never a fallback to a
 *   permissive or anonymous client.
 * - The key must be the service-role class: an anon/publishable JWT
 *   (role claim `anon`) or an `sb_publishable_` opaque key is REFUSED —
 *   silently downgrading to a restricted key class would make every
 *   caller believe it holds privileges it does not (and, worse, hide
 *   misconfiguration behind a confusing RLS denial instead of a clear one).
 * - Key material is never logged; deny reasons carry no secret fragments.
 *
 * `.server.ts` on purpose: service-role credentials must never reach a
 * client bundle.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";
import { FILE_BUCKET, type FileStorageClient } from "./storage-adapter.server";

export interface ServiceStorageConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket?: string;
  /** Injectable policy; a dedicated instance is created per client when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export type ServiceStorageDenyCode =
  | "missing_url"
  | "missing_key"
  | "invalid_url"
  | "wrong_key_class";

export type ServiceStorageClientResult =
  | { ok: true; client: FileStorageClient }
  | { ok: false; code: ServiceStorageDenyCode; reason: string };

/** True when the value is a legacy anon JWT whose role claim is `anon`. */
function isAnonJwt(key: string): boolean {
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")) as {
      role?: unknown;
    };
    return claims.role === "anon";
  } catch {
    return false;
  }
}

/** True when the value looks like a credential this factory must refuse. */
function isWrongKeyClass(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_")) return false;
  return isAnonJwt(key);
}

/** Validate the transport URL: absolute http(s); https everywhere but loopback. */
function validateUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "supabaseUrl is not a valid absolute URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "supabaseUrl must use http(s)" };
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !loopback) {
    return { ok: false, reason: "supabaseUrl must use https outside loopback" };
  }
  return { ok: true };
}

/** Validate a service-storage configuration. Never throws, never logs secrets. */
export function validateServiceStorageConfig(
  config: ServiceStorageConfig,
): { ok: true } | { ok: false; code: ServiceStorageDenyCode; reason: string } {
  const url = config.supabaseUrl.trim();
  const key = config.serviceRoleKey.trim();
  if (!url) return { ok: false, code: "missing_url", reason: "supabaseUrl is required" };
  if (!key) return { ok: false, code: "missing_key", reason: "serviceRoleKey is required" };
  const urlCheck = validateUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, code: "invalid_url", reason: urlCheck.reason };
  }
  if (isWrongKeyClass(key)) {
    return {
      ok: false,
      code: "wrong_key_class",
      reason: "serviceRoleKey must be the service-role class (anon/publishable keys are refused)",
    };
  }
  return { ok: true };
}

/**
 * Build a tenant-scoped storage client over service-role credentials.
 * The returned client is the ONLY surface callers touch: path scoping,
 * timeout, retry and breaker semantics come from the adapter + policy.
 */
export function createServiceStorageClient(
  config: ServiceStorageConfig,
): ServiceStorageClientResult {
  const check = validateServiceStorageConfig(config);
  if (!check.ok) return check;

  const client: SupabaseClient = createClient(
    config.supabaseUrl.trim(),
    config.serviceRoleKey.trim(),
    {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    },
  );

  const failurePolicy: AdapterFailurePolicy =
    config.failurePolicy ??
    createAdapterFailurePolicy({
      provider: "supabase-storage-service",
      timeoutMs: 10_000,
      maxAttempts: 2,
      backoffBaseMs: 200,
      backoffCapMs: 2_000,
      degradedAfterFailures: 3,
      degradedWindowMs: 30_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 15_000,
    });

  return {
    ok: true,
    client: { client, bucket: config.bucket ?? FILE_BUCKET, failurePolicy },
  };
}

/**
 * Environment composition root. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from the provided environment (default process.env) and fails closed with
 * an explicit deny when either is absent — never fabricates a client.
 */
export function serviceStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServiceStorageClientResult {
  return createServiceStorageClient({
    supabaseUrl: env.SUPABASE_URL ?? "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  });
}
