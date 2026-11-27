export interface MobileVersionPlatformConfig {
  min: string | null;
  latest: string | null;
  storeUrl: string | null;
}

export type VersionGateDecision =
  | { kind: "none" }
  | { kind: "soft"; latest: string; storeUrl: string | null }
  | { kind: "block"; min: string; storeUrl: string | null };

const STRICT_SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Compare rule: strict stable semver only (`major.minor.patch`).
 * Missing, malformed, and pre-release/build metadata values are invalid and fail open.
 */
export function normalizeStrictSemver(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !STRICT_SEMVER.test(trimmed)) return null;
  return trimmed;
}

function parseSemverTuple(value: string): [number, number, number] {
  const parts = value.split(".");
  return [Number(parts[0] ?? 0), Number(parts[1] ?? 0), Number(parts[2] ?? 0)];
}

export function compareStrictSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseSemverTuple(a);
  const [bMajor, bMinor, bPatch] = parseSemverTuple(b);

  if (aMajor < bMajor) return -1;
  if (aMajor > bMajor) return 1;
  if (aMinor < bMinor) return -1;
  if (aMinor > bMinor) return 1;
  if (aPatch < bPatch) return -1;
  if (aPatch > bPatch) return 1;

  return 0;
}

function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizePlatformConfig(raw: unknown): MobileVersionPlatformConfig {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    min: normalizeStrictSemver(typeof data.min === "string" ? data.min : null),
    latest: normalizeStrictSemver(typeof data.latest === "string" ? data.latest : null),
    storeUrl: typeof data.storeUrl === "string" ? data.storeUrl.trim() || null : null,
  };
}

export function decideVersionGate(
  currentVersion: string | null | undefined,
  config: MobileVersionPlatformConfig,
): VersionGateDecision {
  const current = normalizeStrictSemver(currentVersion);
  if (!current) return { kind: "none" };

  const min = normalizeStrictSemver(config.min);
  const latest = normalizeStrictSemver(config.latest);
  const storeUrl = normalizeHttpsUrl(config.storeUrl);

  if (min && latest && compareStrictSemver(min, latest) > 0) return { kind: "none" };

  if (min && compareStrictSemver(current, min) < 0) {
    return { kind: "block", min, storeUrl };
  }

  if (latest && compareStrictSemver(current, latest) < 0) {
    return { kind: "soft", latest, storeUrl };
  }

  return { kind: "none" };
}

export async function fetchMobileVersionConfig(args: {
  baseUrl: string;
  platform: "ios" | "android";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MobileVersionPlatformConfig | null> {
  const { baseUrl, platform, fetchImpl = fetch, timeoutMs = 4000 } = args;
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${normalizedBaseUrl}/api/public/mobile-version`, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) return null;

    const json = (await response.json()) as Record<string, unknown>;
    return normalizePlatformConfig(json?.[platform]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
