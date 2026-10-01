/**
 * CoreGrid — storage-adapter tests (mocked Supabase client, no network).
 *
 * Security focus (Constitution §31): the tenant path convention must hold
 * even against a hostile or missing RLS policy — cross-tenant paths,
 * traversal segments and bad expiries never reach the storage layer.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FILE_BUCKET,
  assertTenantScopedPath,
  createTenantSignedUrl,
  getTenantObject,
  putTenantObject,
  type FileStorageClient,
} from "../../frontend/src/lib/files/storage-adapter.server";

/** Minimal storage surface the adapter touches; cast keeps the mock honest. */
function fakeStorageClient(overrides: {
  upload?: ReturnType<typeof vi.fn>;
  download?: ReturnType<typeof vi.fn>;
  createSignedUrl?: ReturnType<typeof vi.fn>;
} = {}): FileStorageClient {
  const upload = overrides.upload ?? vi.fn(async () => ({ data: null, error: null }));
  const download = overrides.download ?? vi.fn(async () => ({ data: new Blob(["x"]), error: null }));
  const createSignedUrl =
    overrides.createSignedUrl ?? vi.fn(async () => ({ data: { signedUrl: "https://signed" }, error: null }));
  const storage = {
    from: vi.fn(() => ({ upload, download, createSignedUrl })),
  };
  return { client: { storage } as unknown as FileStorageClient["client"] };
}

describe("putTenantObject", () => {
  it("uploads to a tenant-scoped path and reports it", async () => {
    const deps = fakeStorageClient();
    const outcome = await putTenantObject(deps, {
      tenantId: "tenant-a",
      purpose: "document",
      filename: "report.pdf",
      body: "hello",
      contentType: "application/pdf",
    });
    expect(outcome).toEqual({ ok: true, objectPath: "tenant-a/document/report.pdf" });
    const upload = (deps.client.storage.from(FILE_BUCKET).upload as ReturnType<typeof vi.fn>);
    expect(upload).toHaveBeenCalledWith(
      "tenant-a/document/report.pdf",
      "hello",
      { contentType: "application/pdf" },
    );
  });

  it("sanitizes hostile filenames before they reach storage", async () => {
    const deps = fakeStorageClient();
    const outcome = await putTenantObject(deps, {
      tenantId: "tenant-a",
      purpose: "evidence",
      filename: "../../etc/passwd",
      body: "x",
      contentType: "image/png",
    });
    expect(outcome).toEqual({ ok: true, objectPath: "tenant-a/evidence/passwd" });
  });

  it("fails closed on unsafe keys without calling storage", async () => {
    const deps = fakeStorageClient();
    for (const filename of ["", "...", "....."]) {
      const outcome = await putTenantObject(deps, {
        tenantId: "tenant-a",
        purpose: "document",
        filename,
        body: "x",
        contentType: "application/pdf",
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("unsafe_object_key");
    }
    expect(deps.client.storage.from).not.toHaveBeenCalled();
  });

  it("surfaces storage errors as failures, never as partial success", async () => {
    const deps = fakeStorageClient({
      upload: vi.fn(async () => ({ data: null, error: { message: "bucket missing" } })),
    });
    const outcome = await putTenantObject(deps, {
      tenantId: "tenant-a",
      purpose: "document",
      filename: "report.pdf",
      body: "x",
      contentType: "application/pdf",
    });
    expect(outcome).toEqual({ ok: false, code: "storage_error", reason: "bucket missing" });
  });
});

describe("assertTenantScopedPath (defense layer under RLS)", () => {
  it("accepts a correctly scoped path", () => {
    expect(assertTenantScopedPath("tenant-a", "tenant-a/document/report.pdf")).toEqual({ ok: true });
  });

  it("denies paths without the tenant prefix (cross-tenant read attempt)", () => {
    const outcome = assertTenantScopedPath("tenant-a", "tenant-b/document/report.pdf");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("tenant_path_required");
  });

  it("denies traversal and empty-segment paths", () => {
    expect(assertTenantScopedPath("tenant-a", "tenant-a/../tenant-b/x.pdf").ok).toBe(false);
    expect(assertTenantScopedPath("tenant-a", "tenant-a//x.pdf").ok).toBe(false);
    expect(assertTenantScopedPath("tenant-a", "tenant-a/document/..").ok).toBe(false);
  });

  it("denies empty tenants and paths", () => {
    expect(assertTenantScopedPath("  ", "tenant-a/x.pdf").ok).toBe(false);
    expect(assertTenantScopedPath("tenant-a", "tenant-a/").ok).toBe(false);
  });
});

describe("getTenantObject / createTenantSignedUrl", () => {
  it("downloads only tenant-scoped paths", async () => {
    const deps = fakeStorageClient();
    const ok = await getTenantObject(deps, "tenant-a", "tenant-a/document/report.pdf");
    expect(ok.ok).toBe(true);
    const denied = await getTenantObject(deps, "tenant-a", "tenant-b/document/report.pdf");
    expect(denied.ok).toBe(false);
  });

  it("issues only short-lived, tenant-scoped signed urls", async () => {
    const deps = fakeStorageClient();
    const ok = await createTenantSignedUrl(deps, "tenant-a", "tenant-a/document/report.pdf", 300);
    expect(ok).toEqual({ ok: true, signedUrl: "https://signed", expiresInSeconds: 300 });
    const clamped = await createTenantSignedUrl(deps, "tenant-a", "tenant-a/document/report.pdf", 86_400);
    expect(clamped.ok).toBe(true);
    if (clamped.ok) expect(clamped.expiresInSeconds).toBeLessThanOrEqual(900);
    const crossTenant = await createTenantSignedUrl(
      deps,
      "tenant-a",
      "tenant-b/document/report.pdf",
      300,
    );
    expect(crossTenant.ok).toBe(false);
  });

  it("rejects non-positive expiries without calling storage", async () => {
    const deps = fakeStorageClient();
    const outcome = await createTenantSignedUrl(deps, "tenant-a", "tenant-a/x.pdf", 0);
    expect(outcome.ok).toBe(false);
    expect(deps.client.storage.from).not.toHaveBeenCalled();
  });
});
