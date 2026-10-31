/**
 * Native WebAuthn (iOS/Android only). Browser/web builds never call this.
 */
import { Platform } from "react-native";

export type NativePasskeyPlatform = "ios" | "android";

export type PasskeyAssertion = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: string;
};

export type PasskeyAttestation = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
    authenticatorData?: string;
  };
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: string;
};

export const PASSKEY_NATIVE_UNAVAILABLE =
  "Passkeys are available in the Sherivs iOS and Android apps.";

export function nativePasskeyPlatform(): NativePasskeyPlatform | null {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  return null;
}

async function loadModule() {
  try {
    return await import("react-native-passkeys");
  } catch {
    return null;
  }
}

export async function nativePasskeysSupported(): Promise<boolean> {
  if (!nativePasskeyPlatform()) return false;
  const mod = await loadModule();
  if (!mod) return false;
  return typeof mod.isSupported === "function" ? mod.isSupported() : true;
}

export async function nativePasskeyGet(
  options: Record<string, unknown>,
): Promise<PasskeyAssertion> {
  const mod = await loadModule();
  if (!mod) throw new Error(PASSKEY_NATIVE_UNAVAILABLE);
  const result = await mod.get(options as never);
  if (!result) throw new Error(PASSKEY_NATIVE_UNAVAILABLE);
  return result as PasskeyAssertion;
}

export async function nativePasskeyCreate(
  options: Record<string, unknown>,
): Promise<PasskeyAttestation> {
  const mod = await loadModule();
  if (!mod) throw new Error(PASSKEY_NATIVE_UNAVAILABLE);
  const result = await mod.create(options as never);
  if (!result) throw new Error(PASSKEY_NATIVE_UNAVAILABLE);
  return result as PasskeyAttestation;
}
