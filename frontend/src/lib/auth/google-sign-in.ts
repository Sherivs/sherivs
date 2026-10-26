/**
 * Google sign-in for invited principals only.
 *
 * The button starts Google's account picker (`prompt=select_account`). A
 * Google account that has no organization / staff / console membership is
 * signed out — visitors cannot self-register through OAuth. Presentation
 * never authorizes; membership rows remain the gate.
 */
export const GOOGLE_OAUTH_PROVIDER = "google" as const;
export const GOOGLE_SELECT_ACCOUNT = "select_account";
export const OAUTH_ERROR_STORAGE_KEY = "sherivs.auth.oauth-error";

export const GOOGLE_UNINVITED_ERROR =
  "This Google account is not invited. Ask your administrator to invite you, then sign in with that registered Google account.";

export const GOOGLE_UNAVAILABLE_ERROR =
  "Google sign-in is not available. Use the email and password from your invitation.";

export const GOOGLE_GENERIC_ERROR =
  "Google sign-in did not complete. Try again, or use the email and password from your invitation.";

export const GOOGLE_CANCELLED_ERROR = "Google sign-in was cancelled.";

export interface GoogleOAuthUser {
  app_metadata?: { provider?: string } | null;
  identities?: Array<{ provider: string }> | null;
}

export interface GoogleOAuthStartArgs {
  provider: typeof GOOGLE_OAUTH_PROVIDER;
  options: {
    redirectTo: string;
    queryParams: Record<string, string>;
    skipBrowserRedirect: true;
  };
}

export function googleOAuthStartOptions(input: {
  redirectTo: string;
  loginHint?: string;
}): GoogleOAuthStartArgs {
  const queryParams: Record<string, string> = { prompt: GOOGLE_SELECT_ACCOUNT };
  const hint = input.loginHint?.trim().toLowerCase();
  if (hint && hint.includes("@")) queryParams.login_hint = hint;
  return {
    provider: GOOGLE_OAUTH_PROVIDER,
    options: {
      redirectTo: input.redirectTo,
      queryParams,
      skipBrowserRedirect: true,
    },
  };
}

/** Return URL after Google. Always same-origin; never trust a caller-supplied host. */
export function googleSignInRedirectTo(origin: string, pathWithSearch: string): string {
  const path = pathWithSearch.startsWith("/") ? pathWithSearch : `/${pathWithSearch}`;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export function isGoogleOnlyIdentity(user: GoogleOAuthUser): boolean {
  const identities = user.identities ?? [];
  if (identities.length > 0) {
    return identities.every((identity) => identity.provider === GOOGLE_OAUTH_PROVIDER);
  }
  return (user.app_metadata?.provider ?? "").toLowerCase() === GOOGLE_OAUTH_PROVIDER;
}

export function shouldRejectUninvitedGooglePrincipal(input: {
  hasMembership: boolean;
  user: GoogleOAuthUser;
}): boolean {
  if (input.hasMembership) return false;
  return isGoogleOnlyIdentity(input.user);
}

export function googleAuthErrorMessage(error: { message?: string } | null | undefined): string {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) return GOOGLE_GENERIC_ERROR;
  if (message.includes("provider is not enabled") || message.includes("unsupported provider")) {
    return GOOGLE_UNAVAILABLE_ERROR;
  }
  if (message.includes("popup") && message.includes("closed")) return GOOGLE_CANCELLED_ERROR;
  return GOOGLE_GENERIC_ERROR;
}

export function parseOAuthCallbackError(search: URLSearchParams): string | null {
  const code = search.get("error");
  if (!code) return null;
  if (code === "access_denied") return GOOGLE_CANCELLED_ERROR;
  return GOOGLE_GENERIC_ERROR;
}

export function persistOAuthError(
  message: string,
  storage: Pick<Storage, "setItem"> | undefined = typeof window === "undefined" ? undefined : window.sessionStorage,
): void {
  storage?.setItem(OAUTH_ERROR_STORAGE_KEY, message);
}

export function consumeOAuthError(
  storage: Pick<Storage, "getItem" | "removeItem"> | undefined = typeof window === "undefined"
    ? undefined
    : window.sessionStorage,
): string | null {
  if (!storage) return null;
  const message = storage.getItem(OAUTH_ERROR_STORAGE_KEY);
  storage.removeItem(OAUTH_ERROR_STORAGE_KEY);
  return message && message.trim() ? message : null;
}

export async function probeGoogleAuthorizeUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    if (response.status >= 400) {
      const body = (await response.json().catch(() => null)) as { msg?: string; message?: string } | null;
      return { ok: false, error: googleAuthErrorMessage({ message: body?.msg ?? body?.message }) };
    }
    const location = response.headers.get("Location");
    return { ok: true, url: location && location.length > 0 ? location : url };
  } catch {
    return { ok: true, url };
  }
}

export async function startGoogleSignIn(
  signInWithOAuth: (args: GoogleOAuthStartArgs) => Promise<{
    data: { url: string | null };
    error: { message: string } | null;
  }>,
  input: { redirectTo: string; loginHint?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await signInWithOAuth(googleOAuthStartOptions(input));
  if (error) return { ok: false, error: googleAuthErrorMessage(error) };
  if (!data.url) return { ok: false, error: GOOGLE_GENERIC_ERROR };
  const probed = await probeGoogleAuthorizeUrl(data.url, fetchImpl);
  if (!probed.ok) return probed;
  if (typeof window !== "undefined") window.location.assign(probed.url);
  return { ok: true };
}
