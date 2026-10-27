import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHERIVS_HOLD_MS,
  SHERIVS_LETTER_ENDS,
  SHERIVS_LETTER_MS,
  SHERIVS_LOADING_FLOOR_MS,
  SHERIVS_LOADING_LETTERS,
  SHERIVS_WORDMARK_SRC,
  nextSherivsLoadingPhase,
  sherivsRevealAt,
  sherivsVisibleWord,
  signInLoadingRemainingMs,
} from "../../frontend/src/lib/auth/signin-loading-wordmark";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("signin loading wordmark", () => {
  it("types sherivs one letter at a time in order", () => {
    expect([...SHERIVS_LOADING_LETTERS]).toEqual(["s", "h", "e", "r", "i", "v", "s"]);
    expect(sherivsVisibleWord(0)).toBe("");
    expect(sherivsVisibleWord(1)).toBe("s");
    expect(sherivsVisibleWord(2)).toBe("sh");
    expect(sherivsVisibleWord(3)).toBe("she");
    expect(sherivsVisibleWord(4)).toBe("sher");
    expect(sherivsVisibleWord(5)).toBe("sheri");
    expect(sherivsVisibleWord(6)).toBe("sheriv");
    expect(sherivsVisibleWord(7)).toBe("sherivs");
  });

  it("widens the official wordmark clip at each letter", () => {
    expect(sherivsRevealAt(0)).toBe(0);
    expect(sherivsRevealAt(1)).toBe(SHERIVS_LETTER_ENDS[0]);
    expect(sherivsRevealAt(7)).toBe(1);
    for (let i = 1; i < SHERIVS_LETTER_ENDS.length; i += 1) {
      expect(SHERIVS_LETTER_ENDS[i]).toBeGreaterThan(SHERIVS_LETTER_ENDS[i - 1]);
    }
  });

  it("loops: letters, hold the full word, then clear", () => {
    let phase = 0;
    const seen: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = nextSherivsLoadingPhase(phase);
      phase = next.phase;
      seen.push(next.visible);
    }
    expect(seen.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(seen[7]).toBe(7);
    expect(seen[8]).toBe(0);
    expect(seen[9]).toBe(1);
    expect(nextSherivsLoadingPhase(6).delayMs).toBe(SHERIVS_LETTER_MS);
    expect(nextSherivsLoadingPhase(7).delayMs).toBe(SHERIVS_HOLD_MS);
    expect(SHERIVS_LETTER_MS).toBeGreaterThanOrEqual(240);
    expect(SHERIVS_HOLD_MS).toBeGreaterThan(SHERIVS_LETTER_MS);
  });

  it("keeps the overlay up for at least one full write", () => {
    expect(SHERIVS_LOADING_FLOOR_MS).toBe(7 * SHERIVS_LETTER_MS + SHERIVS_HOLD_MS);
    expect(signInLoadingRemainingMs(1000, 1000)).toBe(SHERIVS_LOADING_FLOOR_MS);
    expect(signInLoadingRemainingMs(1000, 1000 + SHERIVS_LOADING_FLOOR_MS + 10)).toBe(0);
  });

  it("uses the official wordmark on the login field, not a live font", () => {
    const screen = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    const auth = read("frontend/src/routes/auth.tsx");
    const loading = read("frontend/src/components/app-entry/signin-loading.tsx");
    const css = read("frontend/src/components/app-entry/app-entry.css");
    expect(loading).toContain("SHERIVS_WORDMARK_SRC");
    expect(SHERIVS_WORDMARK_SRC).toBe("/brand/sherivs-app-wordmark.png");
    expect(css).toContain('url("/brand/sherivs-app-wordmark.png")');
    expect(css).toContain("#10182b");
    expect(css).toContain("#1848fd");
    expect(css).toContain("min(10.25rem, 46vw)");
    expect(css).toContain("position: fixed");
    expect(loading).toContain("app-entry-glass-icon");
    expect(loading).toContain("SherivsMark");
    expect(screen).toContain("SignInLoading");
    expect(screen).toContain("onSigningChange(true)");
    expect(auth).toContain("SignInLoading");
    expect(screen).not.toContain("_authenticated");
    expect(screen).not.toContain("portal-shell");
  });
});
