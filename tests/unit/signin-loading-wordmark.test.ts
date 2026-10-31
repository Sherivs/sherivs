import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHERIVS_FADE_MS,
  SHERIVS_HOLD_MS,
  SHERIVS_LOADING_FLOOR_MS,
  SHERIVS_LOADING_LETTERS,
  SHERIVS_LOOP_MS,
  SHERIVS_WORDMARK_SRC,
  SHERIVS_WRITE_MS,
  signInLoadingRemainingMs,
} from "../../frontend/src/lib/auth/signin-loading-wordmark";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("signin loading wordmark", () => {
  it("keeps the official sherivs letter identity", () => {
    expect([...SHERIVS_LOADING_LETTERS]).toEqual(["s", "h", "e", "r", "i", "v", "s"]);
    expect(SHERIVS_WORDMARK_SRC).toBe("/brand/sherivs-app-wordmark.png");
  });

  it("writes as one continuous signature, then holds and fades", () => {
    expect(SHERIVS_WRITE_MS).toBe(1960);
    expect(SHERIVS_HOLD_MS).toBe(450);
    expect(SHERIVS_FADE_MS).toBe(390);
    expect(SHERIVS_LOOP_MS).toBe(SHERIVS_WRITE_MS + SHERIVS_HOLD_MS + SHERIVS_FADE_MS);
    expect(SHERIVS_LOOP_MS).toBe(2800);
    expect(SHERIVS_LOADING_FLOOR_MS).toBe(SHERIVS_WRITE_MS + SHERIVS_HOLD_MS);
  });

  it("keeps the overlay up for at least one full write", () => {
    expect(signInLoadingRemainingMs(1000, 1000)).toBe(SHERIVS_LOADING_FLOOR_MS);
    expect(signInLoadingRemainingMs(1000, 1000 + SHERIVS_LOADING_FLOOR_MS + 10)).toBe(0);
  });

  it("uses a CSS signature write with no letter-step clock or snap reset", () => {
    const screen = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    const auth = read("frontend/src/routes/auth.tsx");
    const loading = read("frontend/src/components/app-entry/signin-loading.tsx");
    const css = read("frontend/src/components/app-entry/app-entry.css");
    expect(loading).toContain("SHERIVS_WORDMARK_SRC");
    expect(loading).not.toContain("useState");
    expect(loading).not.toContain("setTimeout");
    expect(loading).not.toContain("nextSherivsLoadingPhase");
    expect(loading).not.toContain("--sherivs-reveal");
    expect(loading).not.toContain("SherivsMark");
    expect(loading).not.toContain("app-entry-glass-icon");
    expect(css).toContain('url("/brand/sherivs-app-wordmark.png")');
    expect(css).toContain("#10182b");
    expect(css).toContain("#1848fd");
    expect(css).toContain("min(10.25rem, 46vw)");
    expect(css).toContain("position: fixed");
    expect(css).toContain("app-entry-signin-loading-write");
    expect(css).toContain("clip-path: inset(0 100% 0 0)");
    expect(css).toContain("clip-path: inset(0 0 0 0)");
    expect(css).not.toContain("--sherivs-reveal");
    expect(css).not.toContain("transition: clip-path");
    expect(css).not.toContain("app-entry-signin-loading-float");
    expect(css).not.toContain("app-entry-signin-loading-sheen");
    expect(css).not.toContain("app-entry-signin-loading-mark");
    expect(screen).toContain("SignInLoading");
    expect(screen).toContain("onSigningChange(true)");
    expect(auth).toContain("SignInLoading");
    expect(screen).not.toContain("_authenticated");
    expect(screen).not.toContain("portal-shell");
  });
});
