import { describe, expect, it } from "vitest";
import {
  androidApkKeyHashOrigins,
  androidAssetLinks,
} from "../../frontend/src/lib/auth/webauthn-associated-domains";

const CERT =
  "79:57:6A:3B:BB:EF:A0:4F:6F:4C:5D:41:9D:B0:61:A0:86:15:42:2F:E1:43:8C:3A:FA:7E:15:59:E8:72:5E:F8";

describe("Android apk-key-hash origins", () => {
  it("derives the Android origin from a validated signing certificate", () => {
    expect(androidApkKeyHashOrigins({ WEBAUTHN_ANDROID_SHA256_CERTS: CERT })).toEqual([
      "android:apk-key-hash:eVdqO7vvoE9vTF1BnbBhoIYVQi_hQ4w6-n4VWehyXvg",
    ]);
  });

  it("ignores empty, invalid, short, and lowercase fingerprints", () => {
    expect(androidApkKeyHashOrigins({})).toEqual([]);
    expect(
      androidApkKeyHashOrigins({
        WEBAUTHN_ANDROID_SHA256_CERTS: [CERT.toLowerCase(), "79:57:6A", `${CERT}x`].join(","),
      }),
    ).toEqual([]);
  });

  it("deduplicates valid certificates and keeps asset-link validation aligned", () => {
    expect(
      androidApkKeyHashOrigins({ WEBAUTHN_ANDROID_SHA256_CERTS: `${CERT}, ${CERT}` }),
    ).toHaveLength(1);
    expect(androidAssetLinks({ WEBAUTHN_ANDROID_SHA256_CERTS: CERT })).toHaveLength(1);
    expect(androidAssetLinks({ WEBAUTHN_ANDROID_SHA256_CERTS: CERT.toLowerCase() })).toEqual([]);
  });
});
