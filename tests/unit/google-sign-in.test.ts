import { describe, expect, it } from "vitest";
import {
  GOOGLE_CANCELLED_ERROR,
  GOOGLE_GENERIC_ERROR,
  GOOGLE_OAUTH_PROVIDER,
  GOOGLE_SELECT_ACCOUNT,
  GOOGLE_UNAVAILABLE_ERROR,
  GOOGLE_UNINVITED_ERROR,
  consumeOAuthError,
  googleAuthErrorMessage,
  googleOAuthStartOptions,
  googleSignInRedirectTo,
  parseOAuthCallbackError,
  persistOAuthError,
  probeGoogleAuthorizeUrl,
  shouldRejectUninvitedGooglePrincipal,
  startGoogleSignIn,
} from "@/lib/auth/google-sign-in";

describe("googleOAuthStartOptions", () => {
  it("requests Google with the account picker and a same-origin return", () => {
    const args = googleOAuthStartOptions({
      redirectTo: "https://app.sherivs.com/?panel=signin",
      loginHint: "Ada@School.edu",
    });
    expect(args.provider).toBe(GOOGLE_OAUTH_PROVIDER);
    expect(args.options.redirectTo).toBe("https://app.sherivs.com/?panel=signin");
    expect(args.options.queryParams.prompt).toBe(GOOGLE_SELECT_ACCOUNT);
    expect(args.options.queryParams.login_hint).toBe("ada@school.edu");
    expect(args.options.skipBrowserRedirect).toBe(true);
  });

  it("omits login_hint unless the identifier is an email", () => {
    const args = googleOAuthStartOptions({
      redirectTo: "https://app.sherivs.com/auth",
      loginHint: "sheriff.yusuf",
    });
    expect(args.options.queryParams.login_hint).toBeUndefined();
  });
});

describe("googleSignInRedirectTo", () => {
  it("joins origin and path without trusting a caller host", () => {
    expect(googleSignInRedirectTo("https://app.sherivs.com/", "/?panel=signin")).toBe(
      "https://app.sherivs.com/?panel=signin",
    );
    expect(googleSignInRedirectTo("https://app.sherivs.com", "auth")).toBe(
      "https://app.sherivs.com/auth",
    );
  });
});

describe("uninvited Google principal", () => {
  it("rejects a Google-only Auth user with no membership", () => {
    expect(
      shouldRejectUninvitedGooglePrincipal({
        hasMembership: false,
        user: { app_metadata: { provider: "google" }, identities: [{ provider: "google" }] },
      }),
    ).toBe(true);
  });

  it("keeps invited members and email identities", () => {
    expect(
      shouldRejectUninvitedGooglePrincipal({
        hasMembership: true,
        user: { identities: [{ provider: "google" }] },
      }),
    ).toBe(false);
    expect(
      shouldRejectUninvitedGooglePrincipal({
        hasMembership: false,
        user: {
          app_metadata: { provider: "email" },
          identities: [{ provider: "email" }, { provider: "google" }],
        },
      }),
    ).toBe(false);
  });
});

describe("google error copy", () => {
  it("maps provider-disabled and cancel without enumerating accounts", () => {
    expect(googleAuthErrorMessage({ message: "Unsupported provider: provider is not enabled" })).toBe(
      GOOGLE_UNAVAILABLE_ERROR,
    );
    expect(parseOAuthCallbackError(new URLSearchParams("error=access_denied"))).toBe(
      GOOGLE_CANCELLED_ERROR,
    );
    expect(parseOAuthCallbackError(new URLSearchParams("error=server_error"))).toBe(
      GOOGLE_GENERIC_ERROR,
    );
    expect(GOOGLE_UNINVITED_ERROR.toLowerCase()).toContain("invite");
  });

  it("round-trips the one-shot oauth error", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    persistOAuthError("nope", storage);
    expect(consumeOAuthError(storage)).toBe("nope");
    expect(consumeOAuthError(storage)).toBeNull();
  });
});

describe("startGoogleSignIn", () => {
  it("starts OAuth with select_account and surfaces mapped errors", async () => {
    const calls: unknown[] = [];
    const passthrough: typeof fetch = async (input) =>
      new Response(null, { status: 302, headers: { Location: String(input) } });
    const ok = await startGoogleSignIn(
      async (args) => {
        calls.push(args);
        return { data: { url: "https://accounts.google.com/o" }, error: null };
      },
      { redirectTo: "https://app.sherivs.com/?panel=signin" },
      passthrough,
    );
    expect(ok).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      provider: "google",
      options: { queryParams: { prompt: "select_account" }, skipBrowserRedirect: true },
    });

    const failed = await startGoogleSignIn(async () => {
      return { data: { url: null }, error: { message: "provider is not enabled" } };
    }, { redirectTo: "https://app.sherivs.com/auth" });
    expect(failed).toEqual({ ok: false, error: GOOGLE_UNAVAILABLE_ERROR });
  });

  it("keeps the visitor on the login card when Google is not enabled", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({ code: 400, msg: "Unsupported provider: provider is not enabled" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    const probed = await probeGoogleAuthorizeUrl("https://example.supabase.co/auth/v1/authorize?provider=google", fetchImpl);
    expect(probed).toEqual({ ok: false, error: GOOGLE_UNAVAILABLE_ERROR });
  });
});
