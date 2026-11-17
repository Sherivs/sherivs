import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_CONSENT_KEY,
  analyticsAllowed,
  doNotTrackEnabled,
  readAnalyticsConsent,
  shouldAskForAnalyticsConsent,
  writeAnalyticsConsent,
} from "@/lib/analytics/consent";
import { analyticsIdentity, posthogConfig } from "@/lib/analytics/posthog";

function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("analytics consent gating", () => {
  it("defaults to unset (= no analytics) and round-trips a choice", () => {
    const s = mem();
    expect(readAnalyticsConsent(s)).toBe("unset");
    writeAnalyticsConsent(s, "granted");
    expect(readAnalyticsConsent(s)).toBe("granted");
    writeAnalyticsConsent(s, "denied");
    expect(readAnalyticsConsent(s)).toBe("denied");
    s.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ v: "old", c: "granted" }));
    expect(readAnalyticsConsent(s)).toBe("unset"); // policy version changed → ask again
    s.setItem(ANALYTICS_CONSENT_KEY, "{garbage");
    expect(readAnalyticsConsent(s)).toBe("unset");
  });

  it("allows analytics only with key + explicit grant + no DNT + not a student", () => {
    const base = { key: "phc_x", consent: "granted" as const, doNotTrack: false, role: "admin" };
    expect(analyticsAllowed(base)).toBe(true);
    expect(analyticsAllowed({ ...base, consent: "unset" })).toBe(false);
    expect(analyticsAllowed({ ...base, consent: "denied" })).toBe(false);
    expect(analyticsAllowed({ ...base, doNotTrack: true })).toBe(false);
    expect(analyticsAllowed({ ...base, role: "student" })).toBe(false);
    expect(analyticsAllowed({ ...base, key: "" })).toBe(false);
  });

  it("asks only when relevant", () => {
    expect(shouldAskForAnalyticsConsent({ key: "k", consent: "unset", doNotTrack: false })).toBe(
      true,
    );
    expect(shouldAskForAnalyticsConsent({ key: "k", consent: "unset", doNotTrack: true })).toBe(
      false,
    );
    expect(
      shouldAskForAnalyticsConsent({
        key: "k",
        consent: "unset",
        doNotTrack: false,
        role: "student",
      }),
    ).toBe(false);
    expect(shouldAskForAnalyticsConsent({ key: "", consent: "unset", doNotTrack: false })).toBe(
      false,
    );
    expect(shouldAskForAnalyticsConsent({ key: "k", consent: "denied", doNotTrack: false })).toBe(
      false,
    );
  });

  it("detects Do Not Track and Global Privacy Control", () => {
    expect(doNotTrackEnabled({ doNotTrack: "1" } as never)).toBe(true);
    expect(doNotTrackEnabled({ globalPrivacyControl: true } as never)).toBe(true);
    expect(doNotTrackEnabled({ doNotTrack: "0" } as never)).toBe(false);
    expect(doNotTrackEnabled(null)).toBe(false);
  });
});

describe("PostHog config and identity", () => {
  it("uses EU host, no recording, identified-only profiles, masked autocapture", () => {
    const c = posthogConfig(undefined);
    expect(c.api_host).toBe("https://eu.i.posthog.com");
    expect(c.disable_session_recording).toBe(true);
    expect(c.person_profiles).toBe("identified_only");
    expect(c.respect_dnt).toBe(true);
    expect(c.mask_all_text).toBe(true);
    expect(c.mask_all_element_attributes).toBe(true);
    expect(c.session_recording.maskAllInputs).toBe(true);
    expect(c.autocapture.dom_event_allowlist).toEqual(["click", "submit"]);
    const p = c.sanitize_properties({ $current_url: "https://app.sherivs.com/x?token=abc#y" });
    expect(p.$current_url).toBe("https://app.sherivs.com/x");
  });

  it("identifies by internal id + role + tenant only", () => {
    const id = analyticsIdentity({
      id: "u-1",
      role: "teacher",
      tenantId: "t-9",
      ...({ email: "a@b.cc", full_name: "Ada" } as object),
    });
    expect(id).toEqual({ distinctId: "u-1", properties: { role: "teacher", tenant_id: "t-9" } });
    expect(analyticsIdentity({ id: null })).toBeNull();
  });
});

describe("nothing is loaded before consent", () => {
  beforeEach(() => vi.resetModules());
  it("does not import posthog-js until startPosthog is called", async () => {
    const loaded = vi.fn();
    vi.doMock("posthog-js", () => {
      loaded();
      return {
        default: {
          init: vi.fn(),
          identify: vi.fn(),
          capture: vi.fn(),
          opt_in_capturing: vi.fn(),
          opt_out_capturing: vi.fn(),
          reset: vi.fn(),
        },
      };
    });
    const mod = await import("@/lib/analytics/posthog");
    mod.identifyPosthog({ id: "u" });
    mod.capturePosthog("x");
    mod.stopPosthog();
    expect(loaded).not.toHaveBeenCalled();
    const ph = await mod.startPosthog("phc_test", "https://eu.i.posthog.com", {
      appEnv: "staging",
      viteAppEnv: "staging",
    });
    expect(loaded).toHaveBeenCalledTimes(1);
    expect((ph as unknown as { init: ReturnType<typeof vi.fn> }).init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        disable_session_recording: true,
      }),
    );
  });
});
