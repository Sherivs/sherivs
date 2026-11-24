/**
 * Associated-domain documents so iOS/Android passkeys bind to sherivs.com.
 * Team ID and Android cert fingerprints are operator-supplied env, never
 * invented. Empty documents are valid JSON and fail closed (no bogus apps).
 */

import { CANONICAL_APP_HOST, hostnameFromHostHeader } from "@/lib/experience/experience-host";

const BUNDLE_DEFAULT = "com.sherivs.scholar";
const SHA256_CERT_FINGERPRINT = /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/;

export const APP_LINK_PATH_PREFIXES = [
  "/m/",
  "/home/notifications",
  "/results",
  "/fees",
  "/messages",
  "/cbt",
] as const;

function trimList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 128);
}

function androidCertFingerprints(env: Record<string, string | undefined>): string[] {
  return Array.from(
    new Set(
      trimList(env.WEBAUTHN_ANDROID_SHA256_CERTS).filter((value) =>
        SHA256_CERT_FINGERPRINT.test(value),
      ),
    ),
  );
}

function isAppLinksHost(host: string | null | undefined): boolean {
  return hostnameFromHostHeader(host) === CANONICAL_APP_HOST;
}

export function androidApkKeyHashOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return androidCertFingerprints(env).map((fingerprint) => {
    const bytes = Buffer.from(fingerprint.replace(/:/g, ""), "hex");
    return `android:apk-key-hash:${bytes.toString("base64url")}`;
  });
}

function appLinkAasaComponents(): Array<{ "/": string }> {
  const components: Array<{ "/": string }> = [];
  for (const prefix of APP_LINK_PATH_PREFIXES) {
    if (prefix.endsWith("/")) {
      components.push({ "/": `${prefix}*` });
      continue;
    }
    components.push({ "/": prefix }, { "/": `${prefix}/*` });
  }
  return components;
}

export function appleAppSiteAssociation(
  env: Record<string, string | undefined> = process.env,
  host: string | null | undefined = null,
): {
  webcredentials: { apps: string[] };
  applinks?: {
    details: Array<{
      appIDs: string[];
      components: Array<{ "/": string }>;
    }>;
  };
} {
  const team = (env.WEBAUTHN_APPLE_TEAM_ID ?? "").trim().toUpperCase();
  const bundle = (env.WEBAUTHN_IOS_BUNDLE_ID ?? BUNDLE_DEFAULT).trim() || BUNDLE_DEFAULT;
  const apps = /^[A-Z0-9]{10}$/.test(team) ? [`${team}.${bundle}`] : [];
  if (!isAppLinksHost(host)) {
    return { webcredentials: { apps } };
  }

  return {
    webcredentials: { apps },
    applinks: {
      details: [
        {
          appIDs: apps,
          components: appLinkAasaComponents(),
        },
      ],
    },
  };
}

export function androidAssetLinks(
  env: Record<string, string | undefined> = process.env,
  host: string | null | undefined = null,
): Array<{
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}> {
  const fingerprints = androidCertFingerprints(env);
  if (fingerprints.length === 0) return [];
  const packageName = (env.WEBAUTHN_ANDROID_PACKAGE ?? BUNDLE_DEFAULT).trim() || BUNDLE_DEFAULT;
  const target = {
    namespace: "android_app" as const,
    package_name: packageName,
    sha256_cert_fingerprints: fingerprints.map((value) => value.toUpperCase()),
  };

  const relations = [
    ["delegate_permission/common.get_login_creds"],
    ...(isAppLinksHost(host) ? [["delegate_permission/common.handle_all_urls"]] : []),
  ];

  return relations.map((relation) => ({ relation, target }));
}
