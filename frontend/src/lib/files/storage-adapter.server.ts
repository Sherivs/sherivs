/**
 * CoreGrid — Supabase storage adapter for tenant-scoped files
 * (MISSION-V1-012 files, V5.3 Part 22).
 *
 * Thin adapter over the EXISTING Supabase storage stack
 * (`@supabase/supabase-js` via `frontend/src/integrations/supabase`): no new
 * object-storage abstraction, no new dependencies. It adds the code-level
 * guarantee that every object path is prefixed with its `tenant_id`, so the
 * path convention layers defense on top of RLS even if a storage policy is
 * ever missing or mis-scoped.
 *
 * `.server.ts` on purpose: callers hand it a Supabase client that may hold
 * service-role credentials. This module never logs bodies, paths beyond the
 * tenant prefix check, or any key material.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdapterFailurePolicy, type AdapterFailurePolicy } from "../adapters/failure-policy";
import { sanitizeFilename } from "./file-contract";

/** Single V1 bucket; objects are always `tenant_id/purpose/filename`. */
export const FILE_BUCKET = "coregrid-files";

/**
 * Declared failure-semantics policy for the storage adapter (J-045). Reads
 * are idempotent and may retry once; callers may inject their own instance
 * via `FileStorageClient.failurePolicy`.
 */
export const STORAGE_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "supabase-storage",
  timeoutMs: 10_000,
  maxAttempts: 2,
  backoffBaseMs: 200,
  backoffCapMs: 2_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 30_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 15_000,
});

export interface FileStorageClient {
  client: SupabaseClient;
  bucket?: string;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export type FileStorageDenyCode = "tenant_path_required" | "unsafe_object_key" | "storage_error";

/** Internal result for path construction (fail closed). */
type ObjectPathResult =
  | { ok: true; objectPath: string }
  | { ok: false; code: "tenant_path_required" | "unsafe_object_key"; reason: string };

function buildObjectPath(tenantId: string, purpose: string, filename: string): ObjectPathResult {
  if (!tenantId.trim()) {
    return { ok: false, code: "tenant_path_required", reason: "tenantId is required" };
  }
  const sanitized = sanitizeFilename(filename);
  if (!sanitized.ok) {
    return { ok: false, code: "unsafe_object_key", reason: "filename sanitizes to nothing" };
  }
  // Defensive: even a sanitized name must never smuggle traversal segments.
  if (
    sanitized.filename.includes("..") ||
    sanitized.filename.includes("/") ||
    sanitized.filename.includes("\\")
  ) {
    return {
      ok: false,
      code: "unsafe_object_key",
      reason: "filename must not contain path separators or traversal segments",
    };
  }
  return { ok: true, objectPath: `${tenantId}/${purpose}/${sanitized.filename}` };
}

/**
 * Runtime check that an object path (from a descriptor, a grant, or a client)
 * is scoped to the given tenant. Any path without the exact `tenant_id/`
 * prefix — including traversal attempts like `tenant-a/../tenant-b/x` — is
 * denied before it ever reaches Supabase.
 */
export function assertTenantScopedPath(
  tenantId: string,
  objectPath: string,
):
  { ok: true } | { ok: false; code: "tenant_path_required" | "unsafe_object_key"; reason: string } {
  if (!tenantId.trim()) {
    return { ok: false, code: "tenant_path_required", reason: "tenantId is required" };
  }
  const prefix = `${tenantId}/`;
  if (!objectPath.startsWith(prefix)) {
    return {
      ok: false,
      code: "tenant_path_required",
      reason: "object path must start with the tenant prefix",
    };
  }
  const rest = objectPath.slice(prefix.length);
  if (!rest || rest.split("/").some((segment) => segment === "" || segment === "..")) {
    return {
      ok: false,
      code: "unsafe_object_key",
      reason: "object path must not contain empty or traversal segments",
    };
  }
  return { ok: true };
}

export type PutTenantObjectInput = {
  tenantId: string;
  purpose: string;
  filename: string;
  body: Blob | ArrayBuffer | Uint8Array | string;
  contentType: string;
};

export type PutTenantObjectResult =
  { ok: true; objectPath: string } | { ok: false; code: FileStorageDenyCode; reason: string };

export async function putTenantObject(
  deps: FileStorageClient,
  input: PutTenantObjectInput,
): Promise<PutTenantObjectResult> {
  const path = buildObjectPath(input.tenantId, input.purpose, input.filename);
  if (!path.ok) return path;
  const policy = deps.failurePolicy ?? STORAGE_FAILURE_POLICY;
  const outcome = await policy.run({
    operation: "storage.put",
    // Uploads are non-idempotent writes: never transport-retried.
    maxAttempts: 1,
    call: async () => {
      const { data, error } = await deps.client.storage
        .from(deps.bucket ?? FILE_BUCKET)
        .upload(path.objectPath, input.body, { contentType: input.contentType });
      if (error) throw new Error(error.message);
      return data;
    },
  });
  if (outcome.outcome === "error") {
    return { ok: false, code: "storage_error", reason: outcome.reason };
  }
  return { ok: true, objectPath: path.objectPath };
}

export type GetTenantObjectResult =
  { ok: true; data: Blob } | { ok: false; code: FileStorageDenyCode; reason: string };

export async function getTenantObject(
  deps: FileStorageClient,
  tenantId: string,
  objectPath: string,
): Promise<GetTenantObjectResult> {
  const scoped = assertTenantScopedPath(tenantId, objectPath);
  if (!scoped.ok) return scoped;
  const policy = deps.failurePolicy ?? STORAGE_FAILURE_POLICY;
  const outcome = await policy.run({
    operation: "storage.get",
    call: async () => {
      const { data, error } = await deps.client.storage
        .from(deps.bucket ?? FILE_BUCKET)
        .download(objectPath);
      if (error) throw new Error(error.message);
      if (!data) throw new Error("object not found");
      return data;
    },
  });
  if (outcome.outcome === "error") {
    return { ok: false, code: "storage_error", reason: outcome.reason };
  }
  return { ok: true, data: outcome.value };
}

export type SignedUrlResult =
  | { ok: true; signedUrl: string; expiresInSeconds: number }
  | { ok: false; code: FileStorageDenyCode; reason: string };

const MAX_SIGNED_URL_SECONDS = 900;

export async function createTenantSignedUrl(
  deps: FileStorageClient,
  tenantId: string,
  objectPath: string,
  expiresInSeconds: number,
): Promise<SignedUrlResult> {
  const scoped = assertTenantScopedPath(tenantId, objectPath);
  if (!scoped.ok) return scoped;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    return { ok: false, code: "unsafe_object_key", reason: "expiry must be a positive integer" };
  }
  // Signed URLs are short-lived by design; longer asks are clamped, not grown.
  const effective = Math.min(expiresInSeconds, MAX_SIGNED_URL_SECONDS);
  const policy = deps.failurePolicy ?? STORAGE_FAILURE_POLICY;
  const outcome = await policy.run({
    operation: "storage.signedUrl",
    call: async () => {
      const { data, error } = await deps.client.storage
        .from(deps.bucket ?? FILE_BUCKET)
        .createSignedUrl(objectPath, effective);
      if (error) throw new Error(error.message);
      if (!data) throw new Error("no signed url returned");
      return data;
    },
  });
  if (outcome.outcome === "error") {
    return { ok: false, code: "storage_error", reason: outcome.reason };
  }
  return { ok: true, signedUrl: outcome.value.signedUrl, expiresInSeconds: effective };
}
