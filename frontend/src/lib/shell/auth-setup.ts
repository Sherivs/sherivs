/**
 * Owner + member setup copy for Google and platform biometrics.
 * Presentation never authorizes. Google stays invite-only after the provider
 * is enabled. Biometrics are WebAuthn passkeys — Sherivs never stores a print.
 */

export const GOOGLE_PROVIDER_STEPS = [
  "Open the Supabase project that serves app.sherivs.com.",
  "Go to Authentication → Sign in / Providers → Google, and turn the provider on.",
  "Turn on Authentication → Providers → Enable Manual Linking so a password login can connect Google.",
  "In Google Cloud Console create an OAuth 2.0 Web client.",
  "Authorized JavaScript origin: https://app.sherivs.com (and http://localhost:5173 for local).",
  "Authorized redirect URI: https://<project-ref>.supabase.co/auth/v1/callback.",
  "Paste the Client ID and Client secret into the Supabase Google provider and save.",
  "Keep email sign-ups disabled. Invite-only still applies: a Google account with no membership is signed out.",
  "On app.sherivs.com tap Sign in with Google and pick the invited account.",
] as const;

export const GOOGLE_LINK_STEPS = [
  "Sign in with the invited email and password first.",
  "Open Biometric and authentication.",
  "Tap Connect Google and choose the same invited Google account.",
  "After Google returns, this login can use either password or Google.",
] as const;

export const PUSH_DEVICE_STEPS = [
  "Open Notifications while signed in on app.sherivs.com.",
  "Tap Enable push on this device and allow the browser prompt.",
  "Sherivs stores the subscription on this member row only (users.push_token).",
  "Tap Send test. Opening the ping returns to this inbox.",
  "Tap Disable push on this device to unsubscribe and clear the stored token.",
] as const;

export const BIOMETRIC_PASKEY_STEPS = [
  "Serve the app only on HTTPS (app.sherivs.com already is).",
  "Register the WebAuthn relying party as app.sherivs.com. Never collect or store a fingerprint or Face ID image.",
  "The server issues a one-time challenge; the device creates a passkey with user verification (Touch ID, Face ID, or Windows Hello).",
  "Store only the credential ID and public key on the member’s row, tenant-scoped, with an audit event.",
  "At sign-in the server issues a new challenge; the device asserts the passkey. Password remains the fallback.",
  "A lost device is revoked from this screen — the biometric itself never leaves the handset.",
] as const;

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const pk = window.PublicKeyCredential;
  if (!pk?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await pk.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
