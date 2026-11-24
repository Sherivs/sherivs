import { describe, expect, it } from "vitest";
import {
  androidAssetLinks,
  APP_LINK_PATH_PREFIXES,
  appleAppSiteAssociation,
} from "../../frontend/src/lib/auth/webauthn-associated-domains";
import {
  AuthedWebAuthnBodySchema,
  PublicWebAuthnBodySchema,
} from "../../frontend/src/lib/auth/webauthn-http.server";

describe("native associated domains", () => {
  it("advertises no iOS apps until a 10-character team id is configured", () => {
    expect(appleAppSiteAssociation({}).webcredentials.apps).toEqual([]);
    expect(
      appleAppSiteAssociation({
        WEBAUTHN_APPLE_TEAM_ID: "ABCD123456",
      }).webcredentials.apps,
    ).toEqual(["ABCD123456.com.sherivs.scholar"]);
    expect(
      appleAppSiteAssociation({
        WEBAUTHN_APPLE_TEAM_ID: "ABCD123456",
        WEBAUTHN_IOS_BUNDLE_ID: "com.sherivs.scholar",
      }).webcredentials.apps,
    ).toEqual(["ABCD123456.com.sherivs.scholar"]);
  });

  it("adds applinks only on app.sherivs.com and preserves apex webcredentials", () => {
    const env = { WEBAUTHN_APPLE_TEAM_ID: "ABCD123456" };
    expect(appleAppSiteAssociation(env, "sherivs.com")).toEqual({
      webcredentials: { apps: ["ABCD123456.com.sherivs.scholar"] },
    });

    const appHost = appleAppSiteAssociation(env, "app.sherivs.com");
    expect(appHost.webcredentials.apps).toEqual(["ABCD123456.com.sherivs.scholar"]);
    expect(appHost.applinks?.details[0]?.components).toEqual([
      { "/": "/m/*" },
      ...APP_LINK_PATH_PREFIXES.filter((prefix) => !prefix.endsWith("/")).flatMap((prefix) => [
        { "/": prefix },
        { "/": `${prefix}/*` },
      ]),
    ]);
  });

  it("advertises no Android apps until SHA-256 fingerprints are configured", () => {
    expect(androidAssetLinks({})).toEqual([]);
    const fingerprint = "AA:".repeat(31) + "AA";
    const links = androidAssetLinks({ WEBAUTHN_ANDROID_SHA256_CERTS: fingerprint });
    expect(links).toHaveLength(1);
    expect(links[0]?.target.package_name).toBe("com.sherivs.scholar");
    expect(links[0]?.target.sha256_cert_fingerprints[0]).toBe(fingerprint);
    expect(androidAssetLinks({ WEBAUTHN_ANDROID_SHA256_CERTS: fingerprint.toLowerCase() })).toEqual(
      [],
    );
  });

  it("adds handle_all_urls only on app.sherivs.com", () => {
    const fingerprint = "AA:".repeat(31) + "AA";
    const env = { WEBAUTHN_ANDROID_SHA256_CERTS: fingerprint };

    expect(androidAssetLinks(env, "sherivs.com")).toHaveLength(1);
    expect(androidAssetLinks(env, "sherivs.com")[0]?.relation).toEqual([
      "delegate_permission/common.get_login_creds",
    ]);

    const appHost = androidAssetLinks(env, "app.sherivs.com");
    expect(appHost).toHaveLength(2);
    expect(appHost[0]?.relation).toEqual(["delegate_permission/common.get_login_creds"]);
    expect(appHost[1]?.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
  });
});

describe("native WebAuthn HTTP contracts", () => {
  it("accepts authentication options and verify bodies", () => {
    expect(PublicWebAuthnBodySchema.parse({ action: "authentication.options" }).action).toBe(
      "authentication.options",
    );
    expect(() => PublicWebAuthnBodySchema.parse({ action: "credentials.list" })).toThrow();
  });

  it("keeps registration behind the authenticated contract", () => {
    expect(AuthedWebAuthnBodySchema.parse({ action: "registration.options" }).action).toBe(
      "registration.options",
    );
    expect(
      AuthedWebAuthnBodySchema.parse({
        action: "credentials.remove",
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).action,
    ).toBe("credentials.remove");
  });
});
