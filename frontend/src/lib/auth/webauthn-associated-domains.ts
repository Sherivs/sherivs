/**
 * Associated-domain documents so iOS/Android passkeys bind to sherivs.com.
 * Team ID and Android cert fingerprints are operator-supplied env, never
 * invented. Empty documents are valid JSON and fail closed (no bogus apps).
 */

const BUNDLE_DEFAULT = "com.coregrid.app";

function trimList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 128);
}

export function appleAppSiteAssociation(env: Record<string, string | undefined> = process.env): {
  webcredentials: { apps: string[] };
} {
  const team = (env.WEBAUTHN_APPLE_TEAM_ID ?? "").trim().toUpperCase();
  const bundle = (env.WEBAUTHN_IOS_BUNDLE_ID ?? BUNDLE_DEFAULT).trim() || BUNDLE_DEFAULT;
  const apps = /^[A-Z0-9]{10}$/.test(team) ? [`${team}.${bundle}`] : [];
  return { webcredentials: { apps } };
}

export function androidAssetLinks(env: Record<string, string | undefined> = process.env): Array<{
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}> {
  const fingerprints = trimList(env.WEBAUTHN_ANDROID_SHA256_CERTS).filter((value) =>
    /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/i.test(value),
  );
  if (fingerprints.length === 0) return [];
  const packageName = (env.WEBAUTHN_ANDROID_PACKAGE ?? BUNDLE_DEFAULT).trim() || BUNDLE_DEFAULT;
  return [
    {
      relation: ["delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints.map((value) => value.toUpperCase()),
      },
    },
  ];
}
