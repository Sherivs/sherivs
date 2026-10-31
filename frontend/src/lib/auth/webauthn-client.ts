/**
 * Browser helpers for Sherivs passkeys. Talks to server functions, then
 * @simplewebauthn/browser. Never treats a WebAuthn assertion as a session.
 */
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { supabase } from "@/integrations/supabase/client";
import {
  shouldOfferPasskeyEnrollment,
  shouldShowCompactPasskeyAction,
  WEBAUTHN_PUBLIC_ERROR,
  type PasskeyOnboardingState,
} from "./webauthn-policy";
import {
  dismissPasskeyOnboarding,
  getPasskeyAuthenticationOptions,
  getPasskeyOnboardingState,
  getPasskeyRegistrationOptions,
  listPasskeys,
  removePasskey,
  renamePasskey,
  setPasskeyFirstPreference,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "./webauthn.functions";
import type { PasskeyListItem } from "./webauthn-store";

export type { PasskeyListItem, PasskeyOnboardingState };

export const PASSKEY_DEVICE_HELP =
  "Sign in securely with your passkey using your device's supported verification method.";

export const PASSKEY_ENROLL_HELP =
  "Sign in securely with your passkey using your device's supported verification method. Sherivs never sees or stores a fingerprint or face image.";

const PASSKEY_FIRST_HINT = "sherivs.passkey-first";

export async function passkeysSupported(): Promise<boolean> {
  return browserSupportsWebAuthn();
}

export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export async function passkeyAutofillSupported(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

/** UX hint only. Never proof of a credential or a session. */
export function readPasskeyFirstHint(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PASSKEY_FIRST_HINT) !== "0";
  } catch {
    return true;
  }
}

/** True only after this browser recorded a successful Sherivs passkey ceremony. */
export function deviceHasPasskeyLoginHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PASSKEY_FIRST_HINT) === "1";
  } catch {
    return false;
  }
}

export function writePasskeyFirstHint(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PASSKEY_FIRST_HINT, enabled ? "1" : "0");
  } catch {
    /* private mode */
  }
}

export function mapBrowserError(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_CEREMONY_ABORTED") return WEBAUTHN_PUBLIC_ERROR.cancelled;
    if (err.name === "NotAllowedError" || err.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") {
      const cause = err.cause;
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        return WEBAUTHN_PUBLIC_ERROR.cancelled;
      }
    }
    if (err.code === "ERROR_INVALID_DOMAIN" || err.code === "ERROR_INVALID_RP_ID") {
      return WEBAUTHN_PUBLIC_ERROR.unavailable;
    }
    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return WEBAUTHN_PUBLIC_ERROR.already_registered;
    }
  }
  if (
    err instanceof DOMException &&
    (err.name === "NotAllowedError" || err.name === "AbortError")
  ) {
    return WEBAUTHN_PUBLIC_ERROR.cancelled;
  }
  if (err instanceof Error && err.message) {
    if (
      Object.values(WEBAUTHN_PUBLIC_ERROR).includes(
        err.message as (typeof WEBAUTHN_PUBLIC_ERROR)[keyof typeof WEBAUTHN_PUBLIC_ERROR],
      )
    ) {
      return err.message;
    }
  }
  return WEBAUTHN_PUBLIC_ERROR.auth_failed;
}

export async function registerPasskey(label?: string): Promise<PasskeyListItem> {
  if (!browserSupportsWebAuthn()) throw new Error(WEBAUTHN_PUBLIC_ERROR.unsupported);
  try {
    const optionsJSON = await getPasskeyRegistrationOptions();
    const response = await startRegistration({ optionsJSON });
    const created = await verifyPasskeyRegistration({ data: { response, label } });
    writePasskeyFirstHint(true);
    return created;
  } catch (err) {
    const mapped = mapBrowserError(err);
    throw new Error(
      mapped === WEBAUTHN_PUBLIC_ERROR.auth_failed ? WEBAUTHN_PUBLIC_ERROR.register_failed : mapped,
    );
  }
}

async function finishPasskeyAssertion(
  response: Awaited<ReturnType<typeof startAuthentication>>,
): Promise<{ userId: string }> {
  const session = await verifyPasskeyAuthentication({ data: { response } });
  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) throw new Error(WEBAUTHN_PUBLIC_ERROR.session_failed);
  writePasskeyFirstHint(true);
  return { userId: session.userId };
}

export async function authenticateWithPasskey(opts?: {
  autofill?: boolean;
}): Promise<{ userId: string } | null> {
  if (!browserSupportsWebAuthn()) throw new Error(WEBAUTHN_PUBLIC_ERROR.unsupported);
  try {
    const optionsJSON = await getPasskeyAuthenticationOptions();
    const response = await startAuthentication({
      optionsJSON,
      useBrowserAutofill: Boolean(opts?.autofill),
      verifyBrowserAutofillInput: Boolean(opts?.autofill),
    });
    return await finishPasskeyAssertion(response);
  } catch (err) {
    const mapped = mapBrowserError(err);
    if (
      opts?.autofill &&
      (mapped === WEBAUTHN_PUBLIC_ERROR.cancelled || mapped === WEBAUTHN_PUBLIC_ERROR.unavailable)
    ) {
      return null;
    }
    throw new Error(mapped);
  }
}

export function cancelActivePasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony();
}

export async function loadPasskeys(): Promise<PasskeyListItem[]> {
  return listPasskeys();
}

export async function savePasskeyLabel(
  credentialId: string,
  label: string,
): Promise<PasskeyListItem> {
  return renamePasskey({ data: { credentialId, label } });
}

export async function deletePasskey(credentialId: string): Promise<void> {
  await removePasskey({ data: { credentialId } });
}

export async function loadPasskeyOnboardingState(): Promise<PasskeyOnboardingState> {
  return getPasskeyOnboardingState();
}

export async function skipPasskeyOnboarding(): Promise<PasskeyOnboardingState> {
  return dismissPasskeyOnboarding();
}

export async function savePasskeyFirstPreference(
  passkeyFirst: boolean,
): Promise<PasskeyOnboardingState> {
  const state = await setPasskeyFirstPreference({ data: { passkeyFirst } });
  writePasskeyFirstHint(passkeyFirst);
  return state;
}

export async function enrollmentEligible(): Promise<boolean> {
  const [supported, state] = await Promise.all([
    passkeysSupported(),
    loadPasskeyOnboardingState().catch((): PasskeyOnboardingState => ({
      credentialCount: 0,
      onboardingStatus: "dismissed",
      passkeyFirst: true,
      preferencesAvailable: false,
    })),
  ]);
  return shouldOfferPasskeyEnrollment({
    credentialCount: state.credentialCount,
    onboardingStatus: state.onboardingStatus,
    webauthnSupported: supported,
    preferencesAvailable: state.preferencesAvailable,
  });
}

export function passkeyLoginPriority(): boolean {
  return shouldShowCompactPasskeyAction({
    webauthnSupported: browserSupportsWebAuthn(),
    devicePasskeyHint: deviceHasPasskeyLoginHint(),
  });
}
