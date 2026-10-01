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
import { sanitizeFilename } from "./file-contract";

/** Single V1 bucket; objects are always `tenant_id/purpose/filename`. */
export const FILE_BUCKET = "coregrid-files";

export interface FileStorageClient {
  client: SupabaseClient;
  bucket?: string;
}

export type FileStorageDenyCode =
  | "tenant_path_required"
  | "unsafe_object_key"
  | "storage_error";

/** Internal result for path construction (fail closed). */
type ObjectPathResult =
  | { ok: true; objectPath: string }
  | { ok: false; code: "tenant_path_required" | "unsafe_object_key"; reason: string };

function buildObjectPath(
  tenantId: string,
  purpose: string,
  filename: string,
): ObjectPathResult {
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
): { ok: true } | { ok: false; code: "tenant_path_required" | "unsafe_object_key"; reason: string } {
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
  | { ok: true; objectPath: string }
  | { ok: false; code: FileStorageDenyCode; reason: string };

export async function putTenantObject(
  deps: FileStorageClient,
  input: PutTenantObjectInput,
): Promise<PutTenantObjectResult> {
  const path = buildObjectPath(input.tenantId, input.purpose, input.filename);
  if (!path.ok) return path;
  const { error } = await deps.client.storage
    .from(deps.bucket ?? FILE_BUCKET)
    .upload(path.objectPath, input.body, { contentType: input.contentType });
  if (error) {
    return { ok: false, code: "storage_error", reason: error.message };
  }
  return { ok: true, objectPath: path.objectPath };
}

export type GetTenantObjectResult =
  | { ok: true; data: Blob }
  | { ok: false; code: FileStorageDenyCode; reason: string };

export async function getTenantObject(
  deps: FileStorageClient,
  tenantId: string,
  objectPath: string,
): Promise<GetTenantObjectResult> {
  const scoped = assertTenantScopedPath(tenantId, objectPath);
  if (!scoped.ok) return scoped;
  const { data, error } = await deps.client.storage
    .from(deps.bucket ?? FILE_BUCKET)
    .download(objectPath);
  if (error || !data) {
    return { ok: false, code: "storage_error", reason: error?.message ?? "object not found" };
  }
  return { ok: true, data };
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
  const { data, error } = await deps.client.storage
    .from(deps.bucket ?? FILE_BUCKET)
    .createSignedUrl(objectPath, effective);
  if (error || !data) {
    return { ok: false, code: "storage_error", reason: error?.message ?? "no signed url returned" };
  }
  return { ok: true, signedUrl: data.signedUrl, expiresInSeconds: effective };
}
