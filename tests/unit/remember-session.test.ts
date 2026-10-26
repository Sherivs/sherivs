import { describe, expect, it } from "vitest";
import {
  REMEMBER_DURATION_MS,
  REMEMBER_STORAGE_KEY,
  createAuthStorage,
  rememberPreferenceActive,
  rememberUntil,
  setRememberPreference,
} from "@/lib/auth/remember-session";

function memoryStorage(): Storage {
  const mem = new Map<string, string>();
  return {
    get length() {
      return mem.size;
    },
    clear() {
      mem.clear();
    },
    key(index) {
      return [...mem.keys()][index] ?? null;
    },
    getItem(key) {
      return mem.get(key) ?? null;
    },
    setItem(key, value) {
      mem.set(key, value);
    },
    removeItem(key) {
      mem.delete(key);
    },
  };
}

describe("remember preference", () => {
  it("stores a 30-day expiry and expires afterwards", () => {
    const local = memoryStorage();
    const now = 1_700_000_000_000;
    setRememberPreference(true, now, local);
    expect(Number(local.getItem(REMEMBER_STORAGE_KEY))).toBe(rememberUntil(now));
    expect(rememberUntil(now) - now).toBe(REMEMBER_DURATION_MS);
    expect(rememberPreferenceActive(now + 1000, local)).toBe(true);
    expect(rememberPreferenceActive(now + REMEMBER_DURATION_MS + 1, local)).toBe(false);
    expect(local.getItem(REMEMBER_STORAGE_KEY)).toBeNull();
  });
});

describe("createAuthStorage", () => {
  it("writes the Auth token to localStorage only while remembered", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    let now = 1_000;
    const storage = createAuthStorage({ local, session, now: () => now });

    storage.setItem("sb-auth-token", "session-only");
    expect(session.getItem("sb-auth-token")).toBe("session-only");
    expect(local.getItem("sb-auth-token")).toBeNull();

    setRememberPreference(true, now, local);
    storage.setItem("sb-auth-token", "remembered");
    expect(local.getItem("sb-auth-token")).toBe("remembered");
    expect(session.getItem("sb-auth-token")).toBeNull();

    now += REMEMBER_DURATION_MS + 5;
    expect(storage.getItem("sb-auth-token")).toBeNull();
  });
});
