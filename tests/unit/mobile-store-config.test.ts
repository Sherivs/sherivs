/**
 * Scholar store identity. The Expo owner, slug, and EAS project id stay
 * fixed; the store app is com.sherivs.scholar on both platforms.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = JSON.parse(readFileSync(new URL("../../mobile/app.json", import.meta.url), "utf8")) as {
  expo: {
    name: string;
    slug: string;
    scheme: string;
    owner: string;
    icon: string;
    ios: { bundleIdentifier: string; associatedDomains: string[] };
    android: {
      package: string;
      adaptiveIcon: { backgroundColor: string; foregroundImage: string };
      intentFilters: Array<{
        data: Array<{ scheme: string; host: string; pathPrefix?: string }>;
      }>;
    };
    plugins: unknown[];
    web: { favicon: string };
    extra: { eas: { projectId: string } };
  };
};

const eas = JSON.parse(readFileSync(new URL("../../mobile/eas.json", import.meta.url), "utf8")) as {
  build: Record<string, { environment?: string; env?: Record<string, string> }>;
  submit: { production: Record<string, unknown> };
};

describe("Scholar store config", () => {
  it("keeps the sherivs Expo project and the Scholar identifiers", () => {
    expect(app.expo.name).toBe("Scholar");
    expect(app.expo.owner).toBe("sherivs");
    expect(app.expo.slug).toBe("coregrid-mobile");
    expect(app.expo.scheme).toBe("scholar");
    expect(app.expo.extra.eas.projectId).toBe("2e19ca55-cc79-4634-ae8a-bf8b551a6a20");
    expect(app.expo.ios.bundleIdentifier).toBe("com.sherivs.scholar");
    expect(app.expo.android.package).toBe("com.sherivs.scholar");
  });

  it("points splash and adaptive-icon backgrounds at white and keeps the WebAuthn host", () => {
    expect(app.expo.ios.associatedDomains).toEqual([
      "webcredentials:sherivs.com",
      "applinks:app.sherivs.com",
    ]);
    expect(app.expo.android.intentFilters[0]?.data).toEqual([
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/m/" },
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/home/notifications" },
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/results" },
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/fees" },
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/messages" },
      { scheme: "https", host: "app.sherivs.com", pathPrefix: "/cbt" },
    ]);
    expect(app.expo.android.adaptiveIcon.backgroundColor).toBe("#FFFFFF");
    expect(app.expo.android.adaptiveIcon.foregroundImage).toBe("./assets/adaptive-icon.png");
    expect(app.expo.icon).toBe("./assets/icon.png");
    expect(app.expo.web.favicon).toBe("./assets/favicon.png");
    const splash = app.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    ) as [string, { backgroundColor: string; image: string }] | undefined;
    expect(splash?.[1].backgroundColor).toBe("#0B1F3A");
    expect(splash?.[1].image).toBe("./assets/splash-icon.png");
  });

  it("loads the matching EAS environment and does not submit with a paid account", () => {
    for (const name of ["development", "preview", "production"] as const) {
      expect(eas.build[name]?.environment).toBe(name);
      expect(eas.build[name]?.env?.EXPO_PUBLIC_APP_ENV).toBe(name);
    }
    expect(eas.submit.production).toEqual({});
  });
});
