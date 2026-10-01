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
  STORAGE_FAILURE_POLICY,
  assertTenantScopedPath,
  createTenantSignedUrl,
  getTenantObject,
  putTenantObject,
  type FileStorageClient,
} from "../../frontend/src/lib/files/storage-adapter.server";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
} from "../../frontend/src/lib/adapters/failure-policy";

/** Deferred-delay clock: the timeout fires only when the test fires it. */
function manualClock(startMs = 1_000_000) {
  let now = startMs;
  const pending: (() => void)[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const fire of all) fire();
    },
  };
}

/** Flush queued microtasks so the policy has registered its timeout delay. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A policy instance tuned for failure tests (deterministic clock). */
function testPolicy(
  clock: AdapterClock,
  overrides: Partial<Parameters<typeof createAdapterFailurePolicy>[0]> = {},
) {
  return createAdapterFailurePolicy({
    provider: "supabase-storage",
    timeoutMs: 1_000,
    maxAttempts: 1,
    backoffBaseMs: 100,
    backoffCapMs: 1_000,
    degradedAfterFailures: 2,
    degradedWindowMs: 10_000,
    breakerFailureThreshold: 2,
    breakerResetMs: 5_000,
    clock,
    ...overrides,
  });
}

function neverSettlesUpload() {
  return vi.fn(() => new Promise<{ data: null; error: null }>(() => {}));
}

/** Minimal storage surface the adapter touches; cast keeps the mock honest. */
function fakeStorageClient(
  overrides: {
    upload?: ReturnType<typeof vi.fn>;
    download?: ReturnType<typeof vi.fn>;
    createSignedUrl?: ReturnType<typeof vi.fn>;
    failurePolicy?: FileStorageClient["failurePolicy"];
  } = {},
): FileStorageClient {
  const upload = overrides.upload ?? vi.fn(async () => ({ data: null, error: null }));
  const download =
    overrides.download ?? vi.fn(async () => ({ data: new Blob(["x"]), error: null }));
  const createSignedUrl =
    overrides.createSignedUrl ??
    vi.fn(async () => ({ data: { signedUrl: "https://signed" }, error: null }));
  const storage = {
    from: vi.fn(() => ({ upload, download, createSignedUrl })),
  };
  return {
    client: { storage } as unknown as FileStorageClient["client"],
    ...(overrides.failurePolicy ? { failurePolicy: overrides.failurePolicy } : {}),
  };
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
    const upload = deps.client.storage.from(FILE_BUCKET).upload as ReturnType<typeof vi.fn>;
    expect(upload).toHaveBeenCalledWith("tenant-a/document/report.pdf", "hello", {
      contentType: "application/pdf",
    });
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
    expect(assertTenantScopedPath("tenant-a", "tenant-a/document/report.pdf")).toEqual({
      ok: true,
    });
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
    const clamped = await createTenantSignedUrl(
      deps,
      "tenant-a",
      "tenant-a/document/report.pdf",
      86_400,
    );
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

/* ─────────────────────────────────────────────────────────────
 * J-045 failure-semantics wiring (additive; results unchanged)
 * ────────────────────────────────────────────────────────────*/

describe("storage adapter failure policy (J-045)", () => {
  const putInput = {
    tenantId: "tenant-a",
    purpose: "document",
    filename: "report.pdf",
    body: "x",
    contentType: "application/pdf",
  } as const;

  it("declares its policy and defaults to the module policy", () => {
    expect(STORAGE_FAILURE_POLICY.snapshot().provider).toBe("supabase-storage");
    const injected = testPolicy(manualClock().clock);
    const deps = fakeStorageClient({ failurePolicy: injected });
    expect(deps.failurePolicy).toBe(injected);
  });

  it("contains a rejecting storage client as a storage_error result, never a throw", async () => {
    const deps = fakeStorageClient({
      upload: vi.fn(async () => {
        throw new Error("socket hung up");
      }),
    });
    const outcome = await putTenantObject(deps, putInput);
    expect(outcome).toEqual({ ok: false, code: "storage_error", reason: "socket hung up" });
  });

  it("enforces the per-call timeout on a hung storage client", async () => {
    const time = manualClock();
    const deps = fakeStorageClient({
      upload: neverSettlesUpload(),
      failurePolicy: testPolicy(time.clock),
    });
    const pendingPut = putTenantObject(deps, putInput);
    await tick();
    time.fireDelays();
    const outcome = await pendingPut;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("storage_error");
      expect(outcome.reason).toContain("timeout");
    }
  });

  it("denies calls without provider contact once the breaker opens", async () => {
    const time = manualClock();
    const failingUpload = vi.fn(async () => {
      throw new Error("bucket missing");
    });
    const deps = fakeStorageClient({
      upload: failingUpload,
      failurePolicy: testPolicy(time.clock),
    });
    for (let i = 0; i < 2; i += 1) {
      const failed = await putTenantObject(deps, putInput);
      expect(failed).toEqual({ ok: false, code: "storage_error", reason: "bucket missing" });
    }
    const denied = await putTenantObject(deps, putInput);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("storage_error");
      expect(denied.reason).toContain("circuit is open");
    }
    expect(failingUpload).toHaveBeenCalledTimes(2);
    expect(deps.failurePolicy?.snapshot().breaker).toBe("open");
  });

  it("feeds the provider failure history into the trust basis (E-060)", async () => {
    const time = manualClock();
    const deps = fakeStorageClient({
      upload: vi.fn(async () => {
        throw new Error("bucket missing");
      }),
      failurePolicy: testPolicy(time.clock),
    });
    await putTenantObject(deps, putInput);
    await putTenantObject(deps, putInput);
    const basis = deps.failurePolicy?.trustBasis();
    expect(basis).toMatchObject({
      provider: "supabase-storage",
      totalCalls: 2,
      totalFailures: 2,
      consecutiveFailures: 2,
    });
    expect(deps.failurePolicy?.recommendTrust().verdict).toBe("untrusted");
  });

  it("keeps successful reads byte-identical through the policy path", async () => {
    const time = manualClock();
    const deps = fakeStorageClient({ failurePolicy: testPolicy(time.clock) });
    const ok = await getTenantObject(deps, "tenant-a", "tenant-a/document/report.pdf");
    expect(ok.ok).toBe(true);
    const signed = await createTenantSignedUrl(
      deps,
      "tenant-a",
      "tenant-a/document/report.pdf",
      300,
    );
    expect(signed).toEqual({ ok: true, signedUrl: "https://signed", expiresInSeconds: 300 });
  });
});
