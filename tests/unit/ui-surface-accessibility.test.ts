import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL("../..", import.meta.url)), "frontend/src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const auth = read("routes/auth.tsx");
const root = read("routes/__root.tsx");
const shell = read("components/app-shell/app-shell.tsx");
const preview = read("components/workspaces/fixtures/workspace-preview.tsx");
const consoleShell = read("components/internal-console/console-shell.tsx");
const consoleCss = read("components/internal-console/console.css");
const entryCss = read("components/app-entry/app-entry.css");
const footer = read("components/public/site-footer.tsx");
const publicUi = read("components/public/ui.tsx");
const home = read("components/public/sherivs-home.tsx");
const social = read("components/public/company-social-links.tsx");
const map = read("components/public/school-reality-intelligence-map.tsx");

/** The declaration block of the first rule for `selector` in `css`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("UI-02 skip link has a target on every surface", () => {
  it("the root skip link points at #main-content", () => {
    expect(root).toContain('href="#main-content"');
  });
  for (const [name, src] of [
    ["sign-in", auth],
    ["app shell", shell],
    ["workspace preview", preview],
    ["console", consoleShell],
  ] as const) {
    it(`${name} exposes a <main id="main-content"> landmark`, () => {
      expect(src).toMatch(/<main\s[^>]*id="main-content"/);
    });
  }
  it("the console skip link and main agree", () => {
    expect(consoleShell).toContain('href="#main-content"');
    expect(consoleShell).not.toContain('"#console-main"');
    expect(consoleShell).not.toContain('id="console-main"');
  });
  it("both sign-in render paths (loading and form) sit inside a main landmark", () => {
    expect(auth.match(/<main\s[^>]*id="main-content"/g)?.length).toBe(2);
    expect(auth).not.toMatch(/<div className="auth-shell/);
  });
});

describe("UI-02 ARIA validity", () => {
  it("the console search input does not carry aria-expanded (not allowed on a textbox)", () => {
    const at = consoleShell.indexOf('aria-label="Search authorized resources"');
    const input = consoleShell.slice(
      consoleShell.lastIndexOf("<input", at),
      consoleShell.indexOf("/>", at),
    );
    expect(input).not.toContain("aria-expanded");
  });
  it("responsibility cards use a div, not an article, under role=listitem", () => {
    const at = preview.indexOf("workspace-preview-responsibility-card");
    const open = preview.slice(preview.lastIndexOf("<", at), at);
    expect(open.startsWith("<div")).toBe(true);
    const card = preview.slice(
      preview.indexOf("renderResponsibility ="),
      preview.indexOf("return (", preview.indexOf("renderResponsibility =")),
    );
    expect(card).not.toContain("<article");
  });
  it("the reality map graphic has a name and a description", () => {
    const svg = map.slice(map.indexOf('className="sherivs-map-svg"'));
    const head = svg.slice(0, svg.indexOf(">"));
    expect(head).toContain('role="img"');
    expect(head).toContain('aria-labelledby="school-reality-title"');
    expect(head).toContain('aria-describedby="school-reality-desc"');
    expect(map).toContain('id="school-reality-title"');
  });
});

describe("UI-02 target size (WCAG 2.2 · 2.5.8, 24px)", () => {
  it("footer utility links share one 24px-min class", () => {
    expect(footer).toMatch(
      /FOOTER_UTILITY_LINK =\s*"[^"]*\bmin-h-6\b[^"]*\binline-flex\b|FOOTER_UTILITY_LINK =\s*"[^"]*\binline-flex\b[^"]*\bmin-h-6\b/,
    );
    expect(footer.match(/className=\{FOOTER_UTILITY_LINK\}/g)?.length).toBe(3);
  });
  it("breadcrumb links keep a 24px target", () => {
    expect(publicUi).toMatch(
      /className="inline-flex min-h-6 items-center hover:text-\[var\(--sherivs-ink\)\]"/,
    );
  });
  it("standalone social links keep a 24px target", () => {
    expect(social).toMatch(/className="inline-flex min-h-6 items-center gap-2 text-sm/);
  });
  it("sign-in 'Back to site' keeps a 24px target", () => {
    expect(auth).toMatch(/to="\/"\s+className="flex min-h-6/);
  });
  it("forgot-password and remember controls are at least 24px", () => {
    expect(rule(entryCss, ".app-entry-login-forgot")).toMatch(/min-height:\s*1\.5rem/);
    expect(rule(entryCss, ".app-entry-login-remember")).toMatch(/min-height:\s*1\.5rem/);
    expect(rule(entryCss, ".app-entry-login-remember input")).toMatch(/width:\s*1\.1rem/);
  });
  it("the console sidebar toggle cannot be squashed by flex layout", () => {
    expect(rule(consoleCss, ".sherivs-console-icon-btn")).toMatch(/flex:\s*none/);
  });
});

describe("UI-02 links are not distinguished by colour alone", () => {
  it("the in-text privacy link on the dark band is underlined", () => {
    const at = home.indexOf("sherivs-band-link");
    const cls = home.slice(at, home.indexOf('"', at));
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
  });
});
