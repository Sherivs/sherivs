import { afterEach, describe, expect, it } from "vitest";
import {
  Route,
  readMobileVersionPayloadFromEnv,
} from "../../frontend/src/routes/api/public/mobile-version";

const originalEnv = {
  MOBILE_MIN_VERSION_IOS: process.env.MOBILE_MIN_VERSION_IOS,
  MOBILE_LATEST_VERSION_IOS: process.env.MOBILE_LATEST_VERSION_IOS,
  MOBILE_MIN_VERSION_ANDROID: process.env.MOBILE_MIN_VERSION_ANDROID,
  MOBILE_LATEST_VERSION_ANDROID: process.env.MOBILE_LATEST_VERSION_ANDROID,
  MOBILE_STORE_URL_IOS: process.env.MOBILE_STORE_URL_IOS,
  MOBILE_STORE_URL_ANDROID: process.env.MOBILE_STORE_URL_ANDROID,
};

const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: () => Promise<Response> } } };
  }
).options.server.handlers.GET;

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("mobile version public payload", () => {
  it("returns strict semver fields and trims store URLs", () => {
    expect(
      readMobileVersionPayloadFromEnv({
        MOBILE_MIN_VERSION_IOS: " 1.0.0 ",
        MOBILE_LATEST_VERSION_IOS: "1.2.0",
        MOBILE_STORE_URL_IOS: " https://apps.apple.com/app/id123 ",
        MOBILE_MIN_VERSION_ANDROID: "1.0.1",
        MOBILE_LATEST_VERSION_ANDROID: "1.3.0",
        MOBILE_STORE_URL_ANDROID:
          "https://play.google.com/store/apps/details?id=com.sherivs.scholar",
      }),
    ).toEqual({
      ios: {
        min: "1.0.0",
        latest: "1.2.0",
        storeUrl: "https://apps.apple.com/app/id123",
      },
      android: {
        min: "1.0.1",
        latest: "1.3.0",
        storeUrl: "https://play.google.com/store/apps/details?id=com.sherivs.scholar",
      },
    });
  });

  it("fails open by nulling missing and malformed version fields", () => {
    expect(
      readMobileVersionPayloadFromEnv({
        MOBILE_MIN_VERSION_IOS: "1.0",
        MOBILE_LATEST_VERSION_IOS: "1.2.0-beta",
        MOBILE_STORE_URL_IOS: "",
      }),
    ).toEqual({
      ios: { min: null, latest: null, storeUrl: null },
      android: { min: null, latest: null, storeUrl: null },
    });
  });

  it("serves a 200 JSON payload for the public GET route", async () => {
    process.env.MOBILE_MIN_VERSION_IOS = "1.0.0";
    process.env.MOBILE_LATEST_VERSION_IOS = "1.1.0";
    process.env.MOBILE_STORE_URL_IOS = "https://apps.apple.com/app/id123";
    delete process.env.MOBILE_MIN_VERSION_ANDROID;
    delete process.env.MOBILE_LATEST_VERSION_ANDROID;
    delete process.env.MOBILE_STORE_URL_ANDROID;

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ios: {
        min: "1.0.0",
        latest: "1.1.0",
        storeUrl: "https://apps.apple.com/app/id123",
      },
      android: {
        min: null,
        latest: null,
        storeUrl: null,
      },
    });
  });
});
