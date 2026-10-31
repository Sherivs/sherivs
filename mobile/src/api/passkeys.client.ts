/**
 * Native passkey HTTP client. Talks to /api/public/webauthn and /api/webauthn
 * on the deployed Sherivs web origin. Does not use browser WebAuthn.
 */
import type { SherivsSupabaseClient } from "./client";
import type { MobileEnv } from "./contracts/env";
import { ApiError, errorKindForStatus } from "./errors";
import type { SherivsSession } from "./auth.client";
import {
  nativePasskeyCreate,
  nativePasskeyGet,
  nativePasskeysSupported,
  PASSKEY_NATIVE_UNAVAILABLE,
} from "../lib/native-passkey";

export type PasskeyListItem = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string;
};

type JsonMap = Record<string, unknown>;

function asError(status: number, text: string): ApiError {
  let message = `passkey request failed with HTTP ${status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.length > 0) message = parsed.error;
  } catch {
    /* keep status message */
  }
  return new ApiError(errorKindForStatus(status), message, status);
}

async function postJson(
  url: string,
  body: unknown,
  accessToken?: string | null,
): Promise<unknown> {
  let response: Response;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError("network", "passkey request failed to send", null, error);
  }
  const text = await response.text();
  if (!response.ok) throw asError(response.status, text);
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("server", "passkey response was not valid JSON");
  }
}

export async function passkeysAvailableOnThisDevice(): Promise<boolean> {
  return nativePasskeysSupported();
}

export async function signInWithPasskey(
  client: SherivsSupabaseClient,
  env: MobileEnv,
): Promise<SherivsSession> {
  if (!(await nativePasskeysSupported())) {
    throw new ApiError("not_configured", PASSKEY_NATIVE_UNAVAILABLE);
  }
  const options = (await postJson(`${env.sherivsWebBaseUrl}/api/public/webauthn`, {
    action: "authentication.options",
  })) as JsonMap;
  const assertion = await nativePasskeyGet(options);
  const minted = (await postJson(`${env.sherivsWebBaseUrl}/api/public/webauthn`, {
    action: "authentication.verify",
    response: assertion,
  })) as { accessToken?: string; refreshToken?: string };
  if (!minted.accessToken || !minted.refreshToken) {
    throw new ApiError("server", "passkey sign-in returned no session");
  }
  const { data, error } = await client.auth.setSession({
    access_token: minted.accessToken,
    refresh_token: minted.refreshToken,
  });
  if (error) throw new ApiError("auth", error.message);
  if (!data.session) throw new ApiError("auth", "passkey sign-in returned no session");
  return data.session;
}

export async function listPasskeys(env: MobileEnv, accessToken: string): Promise<PasskeyListItem[]> {
  const result = await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "credentials.list" },
    accessToken,
  );
  return Array.isArray(result) ? (result as PasskeyListItem[]) : [];
}

export async function registerPasskey(
  env: MobileEnv,
  accessToken: string,
  label?: string,
): Promise<PasskeyListItem> {
  if (!(await nativePasskeysSupported())) {
    throw new ApiError("not_configured", PASSKEY_NATIVE_UNAVAILABLE);
  }
  const options = (await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "registration.options" },
    accessToken,
  )) as JsonMap;
  const attestation = await nativePasskeyCreate(options);
  const created = await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "registration.verify", response: attestation, label },
    accessToken,
  );
  return created as PasskeyListItem;
}

export async function removePasskey(
  env: MobileEnv,
  accessToken: string,
  credentialId: string,
): Promise<void> {
  await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "credentials.remove", credentialId },
    accessToken,
  );
}

export async function passkeyOnboardingState(
  env: MobileEnv,
  accessToken: string,
): Promise<{ credentialCount: number; onboardingStatus: string }> {
  const result = (await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "onboarding.state" },
    accessToken,
  )) as { credentialCount?: number; onboardingStatus?: string };
  return {
    credentialCount: result.credentialCount ?? 0,
    onboardingStatus: result.onboardingStatus ?? "pending",
  };
}

export async function dismissPasskeyOnboarding(env: MobileEnv, accessToken: string): Promise<void> {
  await postJson(
    `${env.sherivsWebBaseUrl}/api/webauthn`,
    { action: "onboarding.dismiss" },
    accessToken,
  );
}
