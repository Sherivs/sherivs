/**
 * CoreGrid Mobile V1-010 — server-function URL contract client tests.
 *
 * Validates the mobile client against the repository's verified TanStack
 * Start server-function HTTP contract (scripts/exercise-foundation-loop.mjs):
 * URL shape, marker header, bearer authentication, JSON body envelope
 * {"data": …}, cross-JSON result unwrapping, and fail-closed error mapping.
 */
import { describe, expect, it } from "vitest";
import { MobileEnvError, parseMobileEnv } from "../../mobile/src/api/contracts/env";
import { ApiError } from "../../mobile/src/api/errors";
import { SERVER_FN_URL_CONTRACT, invokeServerFn, serverFnIdFor, serverFnUrl, type ServerFnCaller } from "../../mobile/src/api/serverFn.client";

const FN_ID = "a".repeat(64);

function env(): ReturnType<typeof parseMobileEnv> {
  return parseMobileEnv({
    EXPO_PUBLIC_APP_ENV: "development",
    EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
    EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://app.coregrid.example",
    EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: FN_ID,
    EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: FN_ID,
  });
}

function callerWith(
  fetchImpl: typeof fetch,
  overrides: Partial<ServerFnCaller> = {},
): ServerFnCaller {
  return { env: env(), accessToken: "jwt.token.value", fetchImpl, ...overrides };
}

function okResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("mobile server-function URL contract", () => {
  it("builds the /_serverFn/<id> URL and rejects missing ids fail-closed", () => {
    expect(serverFnUrl(env(), FN_ID)).toBe(
      `https://app.coregrid.example${SERVER_FN_URL_CONTRACT.routePrefix}/${FN_ID}`,
    );
    const unconfigured = parseMobileEnv({
      EXPO_PUBLIC_APP_ENV: "development",
      EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
      EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://app.coregrid.example",
      EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: "",
      EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: "",
    });
    expect(() => serverFnIdFor(unconfigured, "recordFoundationLoop")).toThrow(ApiError);
    try {
      serverFnIdFor(unconfigured, "recordFoundationLoop");
    } catch (error) {
      expect(error instanceof ApiError && error.kind).toBe("not_configured");
    }
  });

  it("POSTs the data envelope with bearer auth and the marker header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return okResponse(JSON.stringify({ result: { ok: true, replayed: false } }));
    };

    const payload = { missionId: "COREGRID-MISSION-001", idempotencyKey: "idem-0001" };
    const result = await invokeServerFn<{ ok: boolean; replayed: boolean }>(
      callerWith(fetchImpl),
      "recordFoundationLoop",
      payload,
    );

    expect(result).toEqual({ ok: true, replayed: false });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url).toBe(`https://app.coregrid.example/_serverFn/${FN_ID}`);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt.token.value");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get(SERVER_FN_URL_CONTRACT.markerHeader)).toBe("true");
    expect(JSON.parse(String(init.body))).toEqual({ data: payload });
  });

  it("unwraps a bare (non-enveloped) JSON response", async () => {
    const fetchImpl: typeof fetch = async () =>
      okResponse(JSON.stringify({ ok: true, tenant_id: "t1", identities: [] }));
    const result = await invokeServerFn<{ ok: boolean }>(callerWith(fetchImpl), "recordFoundationLoop", {});
    expect(result).toEqual({ ok: true, tenant_id: "t1", identities: [] });
  });

  it("maps a cross-JSON error envelope onto a server ApiError", async () => {
    const fetchImpl: typeof fetch = async () =>
      okResponse(JSON.stringify({ error: { message: "Unauthorized: Invalid token" } }));
    await expect(
      invokeServerFn(callerWith(fetchImpl), "recordFoundationLoop", {}),
    ).rejects.toMatchObject({ kind: "server", message: "Unauthorized: Invalid token" });
  });

  it("maps HTTP status codes onto the closed error taxonomy", async () => {
    const fetchImpl: typeof fetch = async () => new Response("forbidden", { status: 403 });
    await expect(
      invokeServerFn(callerWith(fetchImpl), "listIdentities", {}),
    ).rejects.toMatchObject({ kind: "authorization", status: 403 });

    const serverError: typeof fetch = async () => new Response("boom", { status: 503 });
    await expect(
      invokeServerFn(callerWith(serverError), "listIdentities", {}),
    ).rejects.toMatchObject({ kind: "server" });
  });

  it("maps transport failures onto the network kind", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("Failed to fetch");
    };
    await expect(
      invokeServerFn(callerWith(fetchImpl), "listIdentities", {}),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("GET contracts carry input in the query string without a body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return okResponse(JSON.stringify({ result: { ok: true, tenant_id: "t-1", identities: [] } }));
    };

    await invokeServerFn(callerWith(fetchImpl), "listIdentities", { limit: 50 });
    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(init.method).toBe("GET");
    expect(url).toBe(`https://app.coregrid.example/_serverFn/${FN_ID}?input=${encodeURIComponent(JSON.stringify({ limit: 50 }))}`);
    expect(init.body).toBeUndefined();
  });

  it("an invalid environment cannot even construct a caller", () => {
    expect(() =>
      parseMobileEnv({
        EXPO_PUBLIC_APP_ENV: "development",
        EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
        EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://app.coregrid.example",
        EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: "zz",
        EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: "",
      }),
    ).toThrow(MobileEnvError);
  });
});