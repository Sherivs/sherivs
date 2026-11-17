import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastBetween } from "@/lib/brand/tenant-contrast";

const SRC = join(fileURLToPath(new URL("../..", import.meta.url)), "frontend/src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const publicCss = read("styles/sherivs-public.css");
const entryCss = read("components/app-entry/app-entry.css");
const consoleCss = read("components/internal-console/console.css");
const shellCss = read("components/app-shell/app-shell.css");
const publicUi = read("components/public/ui.tsx");
const auth = read("routes/auth.tsx");
const ratio = (a: string, b: string) => contrastBetween(a, b)!;

// Backgrounds measured behind form fields in a real browser (WCAG 1.4.11 asks for 3:1).
const PAGE_SURFACES = ["#ffffff", "#eef8ff", "#f1faff", "#e8ecf6", "#eaf1f8"];
const CONTROL_EDGE = "#76819a";
// Navy surfaces the light focus ring sits on, and the light surfaces the dark ring sits on.
const NAVY = ["#0f172a", "#10182b", "#1a2744"];
const LIGHT = ["#ffffff", "#f4f7fb", "#eef2f8", "#e8f1ff"];

describe("UI-04 field boundaries are at least 3:1", () => {
  it("the shared control edge reads on every light surface", () => {
    for (const bg of PAGE_SURFACES) expect(ratio(CONTROL_EDGE, bg), bg).toBeGreaterThanOrEqual(3);
  });
  it("the public token and the shared input class use it", () => {
    expect(publicCss).toContain(`--sherivs-control-border: ${CONTROL_EDGE}`);
    expect(publicUi).toContain("border-[var(--sherivs-control-border)]");
    expect(publicUi).not.toMatch(/inputClass =\s*"[^"]*border-\[var\(--sherivs-border\)\]/);
  });
  it("sign-in, console and app-shell fields use it", () => {
    expect(entryCss).toMatch(/\.app-entry-login-input \{[^}]*border:\s*1px solid #76819a/);
    expect(consoleCss).toMatch(/\.sherivs-console-search \{[^}]*border:\s*1px solid #76819a/);
    expect(consoleCss).toMatch(
      /\.sherivs-console-form select[^{]*\{[^}]*border:\s*1px solid #76819a/,
    );
    expect(consoleCss).toMatch(/fixture-switch select \{[^}]*border:\s*1px solid #76819a/);
    expect(shellCss).toContain("--shell-control-line: #76819a");
    expect(shellCss).toMatch(
      /\.app-shell-scope-switcher select \{[^}]*var\(--shell-control-line\)/,
    );
  });
  it("the public input placeholder is not the pale grey", () => {
    expect(publicUi).not.toContain("#9aa3b8");
    expect(ratio("#566179", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("UI-04 focus rings are at least 3:1 on the surface they sit on", () => {
  it("sign-in uses the deep blue ring", () => {
    expect(entryCss).toMatch(/\.app-entry :focus-visible \{\s*outline:\s*2px solid #0d37ca/);
    for (const bg of LIGHT) expect(ratio("#0d37ca", bg), bg).toBeGreaterThanOrEqual(3);
  });
  it("the app shell uses the deep blue ring, and its navy header the light one", () => {
    expect(shellCss).toMatch(
      /\.app-shell :where\([^)]*\):focus-visible \{\s*outline:\s*3px solid #0d37ca/,
    );
    expect(shellCss).not.toContain("#ffbf47");
    expect(shellCss).toMatch(
      /\.app-shell-header :where\([^)]*\):focus-visible \{\s*outline-color:\s*#93b0ff/,
    );
    for (const bg of NAVY) expect(ratio("#93b0ff", bg), bg).toBeGreaterThanOrEqual(3);
  });
  it("public dark bands use the light ring, except inside their light cards", () => {
    expect(publicCss).toMatch(/\.sherivs-band-dusk :focus-visible \{\s*outline-color:\s*#93b0ff/);
    expect(publicCss).toMatch(
      /\.sherivs-band-dusk \.sherivs-glass-card :focus-visible \{\s*outline-color:\s*var\(--sherivs-focus\)/,
    );
    for (const bg of LIGHT) expect(ratio("#1848fd", bg), bg).toBeGreaterThanOrEqual(3);
  });
});

describe("UI-04 sign-in page has its own title", () => {
  it("does not inherit the marketing title", () => {
    expect(auth).toMatch(/head: \(\) => \(\{ meta: \[\{ title: "Sign in/);
  });
});
