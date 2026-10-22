/**
 * Sherivs — service-role storage client factory tests (MISSION-R-103).
 *
 * Focus: fail-closed composition. Missing, malformed or wrong-class
 * credentials never produce a storage client; a valid configuration wires
 * the tenant-scoped adapter surface (path convention + failure policy) and
 * never leaks key material into results or errors.
 */
import { describe, expect, it } from "vitest";
import {
  FILE_BUCKET,
  putTenantObject,
  getTenantObject,
} from "../../frontend/src/lib/files/storage-adapter.server";
import {
  createServiceStorageClient,
  serviceStorageFromEnv,
  validateServiceStorageConfig,
} from "../../frontend/src/lib/files/storage-service.server";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
} from "../../frontend/src/lib/adapters/failure-policy";

// supabase-js constructs a RealtimeClient eagerly and requires a native
// WebSocket (Node 22+). These tests never open a socket, so on older runtimes
// provide an inert constructor instead of failing composition. No-op on Node 22.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = class InertWebSocket {
    constructor() {
      throw new Error("network disabled in unit tests");
    }
  };
}

const SERVICE_KEY = "sb_secret_service_key_fixture_not_a_real_credential";
const PROD_URL = "https://nwrflbpbhyiqdptmlccm.supabase.co";

/** A syntactically-valid legacy JWT with a given role claim (not a real key). */
function fakeJwt(role: string): string {
  const b64 = (obj: object): string =>
    Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role,
    ref: "nwrflbpbhyiqdptmlccm",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

describe("configuration validation (fail closed)", () => {
  it("denies missing URL and missing key with explicit reasons", () => {
    const noUrl = validateServiceStorageConfig({ supabaseUrl: "", serviceRoleKey: SERVICE_KEY });
    expect(noUrl).toMatchObject({ ok: false, code: "missing_url" });

    const noKey = validateServiceStorageConfig({ supabaseUrl: PROD_URL, serviceRoleKey: "  " });
    expect(noKey).toMatchObject({ ok: false, code: "missing_key" });
  });

  it("denies malformed and non-http(s) URLs", () => {
    for (const url of ["not a url", "file:///etc/passwd", "ftp://host.example"]) {
      const check = validateServiceStorageConfig({ supabaseUrl: url, serviceRoleKey: SERVICE_KEY });
      expect(check).toMatchObject({ ok: false, code: "invalid_url" });
    }
  });

  it("requires https outside loopback", () => {
    const insecure = validateServiceStorageConfig({
      supabaseUrl: "http://db.example.supabase.co",
      serviceRoleKey: SERVICE_KEY,
    });
    expect(insecure).toMatchObject({ ok: false, code: "invalid_url" });

    const loopback = validateServiceStorageConfig({
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: SERVICE_KEY,
    });
    expect(loopback).toEqual({ ok: true });
  });

  it("refuses anon-class and publishable keys (wrong key class is a silent downgrade)", () => {
    const anonJwt = validateServiceStorageConfig({
      supabaseUrl: PROD_URL,
      serviceRoleKey: fakeJwt("anon"),
    });
    expect(anonJwt).toMatchObject({ ok: false, code: "wrong_key_class" });

    const publishable = validateServiceStorageConfig({
      supabaseUrl: PROD_URL,
      serviceRoleKey: "sb_publishable_some_public_key",
    });
    expect(publishable).toMatchObject({ ok: false, code: "wrong_key_class" });
  });

  it("accepts the service-role key classes", () => {
    expect(
      validateServiceStorageConfig({ supabaseUrl: PROD_URL, serviceRoleKey: SERVICE_KEY }),
    ).toEqual({ ok: true });
    expect(
      validateServiceStorageConfig({
        supabaseUrl: PROD_URL,
        serviceRoleKey: fakeJwt("service_role"),
      }),
    ).toEqual({ ok: true });
  });

  it("deny reasons never carry key material", () => {
    const key = "sb_publishable_SUPER_SECRET_LOOKING_VALUE_9182";
    const denied = validateServiceStorageConfig({ supabaseUrl: PROD_URL, serviceRoleKey: key });
    if (denied.ok) throw new Error("expected denial");
    expect(denied.reason).not.toContain(key);
    expect(denied.reason).not.toContain("9182");
  });
});

describe("client composition", () => {
  it("builds an adapter client with the default bucket and a declared policy", () => {
    const result = createServiceStorageClient({
      supabaseUrl: PROD_URL,
      serviceRoleKey: SERVICE_KEY,
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.client.bucket).toBe(FILE_BUCKET);
    expect(result.client.failurePolicy?.snapshot().provider).toBe("supabase-storage-service");
    expect(result.client.failurePolicy?.snapshot().declared.timeoutMs).toBe(10_000);
    expect(typeof result.client.client.storage.from).toBe("function");
  });

  it("honors a custom bucket and an injected failure policy", () => {
    const clock: AdapterClock = {
      nowMs: () => 1_000,
      delay: () => Promise.resolve(),
    };
    const policy = createAdapterFailurePolicy({
      provider: "supabase-storage-test",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 100,
      backoffCapMs: 1_000,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 3,
      breakerResetMs: 5_000,
      clock,
    });
    const result = createServiceStorageClient({
      supabaseUrl: PROD_URL,
      serviceRoleKey: SERVICE_KEY,
      bucket: "custom-bucket",
      failurePolicy: policy,
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.client.bucket).toBe("custom-bucket");
    expect(result.client.failurePolicy).toBe(policy);
  });

  it("composes the tenant-path convention: path denials happen before any network call", async () => {
    const result = createServiceStorageClient({
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: SERVICE_KEY,
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    const deps = result.client;

    const emptyTenant = await putTenantObject(deps, {
      tenantId: "  ",
      purpose: "evidence",
      filename: "escape.txt",
      body: "x",
      contentType: "text/plain",
    });
    expect(emptyTenant).toMatchObject({ ok: false, code: "tenant_path_required" });

    const crossTenant = await getTenantObject(deps, "tenant-b", "tenant-a/evidence/secret.txt");
    expect(crossTenant).toMatchObject({ ok: false, code: "tenant_path_required" });
  });
});

describe("environment composition root", () => {
  it("fails closed with explicit deny codes when the environment is incomplete", () => {
    const empty = serviceStorageFromEnv({});
    expect(empty).toMatchObject({ ok: false, code: "missing_url" });

    const partial = serviceStorageFromEnv({ SUPABASE_URL: PROD_URL });
    expect(partial).toMatchObject({ ok: false, code: "missing_key" });

    const emptyString = serviceStorageFromEnv({
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });
    expect(emptyString).toMatchObject({ ok: false, code: "missing_url" });
  });

  it("never fabricates a client from a wrong-class environment key", () => {
    const result = serviceStorageFromEnv({
      SUPABASE_URL: PROD_URL,
      SUPABASE_SERVICE_ROLE_KEY: fakeJwt("anon"),
    });
    expect(result).toMatchObject({ ok: false, code: "wrong_key_class" });
  });

  it("composes from a complete environment", () => {
    const result = serviceStorageFromEnv({
      SUPABASE_URL: PROD_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.client.bucket).toBe(FILE_BUCKET);
  });
});
