import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

vi.mock("../../mobile/src/lib/native-passkey", () => ({
  PASSKEY_NATIVE_UNAVAILABLE: "Passkeys are available in the Sherivs iOS and Android apps.",
  nativePasskeyPlatform: () => null,
  nativePasskeysSupported: async () => true,
  nativePasskeyGet: async () => ({
    id: "cred",
    rawId: "cred",
    type: "public-key",
    response: {
      clientDataJSON: "x".repeat(16),
      authenticatorData: "y".repeat(16),
      signature: "z".repeat(16),
    },
  }),
  nativePasskeyCreate: async () => ({
    id: "cred",
    rawId: "cred",
    type: "public-key",
    response: {
      clientDataJSON: "x".repeat(16),
      attestationObject: "y".repeat(16),
    },
  }),
}));

describe("mobile passkeys", () => {
  it("exposes passkey sign-in on iOS/Android screens, not the browser login", () => {
    const signIn = read("mobile/app/sign-in.tsx");
    const settings = read("mobile/app/(app)/settings.tsx");
    const webAuth = read("frontend/src/routes/auth.tsx");
    expect(signIn).toContain("Sign in with a passkey");
    expect(signIn).toContain('Platform.OS === "ios" || Platform.OS === "android"');
    expect(settings).toContain("Register a passkey");
    expect(webAuth).not.toContain("Sign in with a passkey");
  });

  it("calls the public WebAuthn HTTP contract then sets the GoTrue session", async () => {
    const { parseMobileEnv } = await import("../../mobile/src/api/contracts/env");
    const { signInWithPasskey } = await import("../../mobile/src/api/passkeys.client");
    const env = parseMobileEnv({
      EXPO_PUBLIC_APP_ENV: "development",
      EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
      EXPO_PUBLIC_SHERIVS_WEB_BASE_URL: "https://app.sherivs.com",
      EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: "",
      EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: "",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ challenge: "abc", rpId: "sherivs.com" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: "access", refreshToken: "refresh", userId: "user-1" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchImpl);
    const setSession = vi.fn(async () => ({
      data: { session: { access_token: "access", user: { id: "user-1" } } },
      error: null,
    }));
    const client = { auth: { setSession } } as never;
    await expect(signInWithPasskey(client, env)).resolves.toMatchObject({ access_token: "access" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://app.sherivs.com/api/public/webauthn");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      action: "authentication.options",
    });
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
    vi.unstubAllGlobals();
  });
});
