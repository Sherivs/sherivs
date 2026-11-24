import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export interface MobileVersionPlatformPayload {
  min: string | null;
  latest: string | null;
  storeUrl: string | null;
}

export interface MobileVersionPayload {
  ios: MobileVersionPlatformPayload;
  android: MobileVersionPlatformPayload;
}

const STRICT_SEMVER = /^\d+\.\d+\.\d+$/;

function readSemver(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !STRICT_SEMVER.test(trimmed)) return null;
  return trimmed;
}

function readOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function readMobileVersionPayloadFromEnv(
  env: Record<string, string | undefined>,
): MobileVersionPayload {
  return {
    ios: {
      min: readSemver(env.MOBILE_MIN_VERSION_IOS),
      latest: readSemver(env.MOBILE_LATEST_VERSION_IOS),
      storeUrl: readOptionalText(env.MOBILE_STORE_URL_IOS),
    },
    android: {
      min: readSemver(env.MOBILE_MIN_VERSION_ANDROID),
      latest: readSemver(env.MOBILE_LATEST_VERSION_ANDROID),
      storeUrl: readOptionalText(env.MOBILE_STORE_URL_ANDROID),
    },
  };
}

export const Route = createFileRoute("/api/public/mobile-version")({
  server: {
    handlers: {
      GET: async () => Response.json(readMobileVersionPayloadFromEnv(process.env)),
    },
  },
});
