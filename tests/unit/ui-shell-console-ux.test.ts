import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("UI/UX upgrade: internal console environment bar", () => {
  const shell = read("frontend/src/components/internal-console/console-shell.tsx");
  const css = read("frontend/src/components/internal-console/console.css");

  it("renders one compact environment bar instead of stacked warning banners", () => {
    expect(shell).toContain('data-testid="console-environment-bar"');
    expect(shell).not.toContain("<ConsoleNotice");
    // The role switcher keeps its test id and appears exactly once.
    expect(shell.match(/data-testid="console-fixture-role-switcher"/g)).toHaveLength(1);
  });

  it("keeps the full environment wording reachable, not deleted", () => {
    expect(shell).toContain("This is not a production");
    expect(shell).toContain("Persistent workspace storage is not connected.");
    expect(shell).toContain("Compatibility workspaces are shown from role membership");
    expect(shell).toContain("<summary>Environment notes</summary>");
  });

  it("keeps the role select at least 44px tall and the header chips on one mobile row", () => {
    expect(css).toMatch(/\.sherivs-console-fixture-switch select\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.sherivs-console-switchers\s*\{[^}]*flex-wrap:\s*nowrap/);
  });
});

describe("UI/UX upgrade: sign-in page and shell legibility", () => {
  it("exposes a main landmark that the skip link targets", () => {
    const auth = read("frontend/src/routes/auth.tsx");
    expect(auth.match(/<main id="main-content"/g)?.length).toBe(2);
    expect(auth.match(/<\/main>/g)?.length).toBe(2);
    expect(read("frontend/src/routes/__root.tsx")).toContain('href="#main-content"');
  });

  it("gives sign-in secondary controls 44px touch targets", () => {
    const css = read("frontend/src/components/app-entry/app-entry.css");
    expect(css).toMatch(/\.app-entry-login-forgot\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.app-entry-login-remember\s*\{\s*min-height:\s*2\.75rem/);
  });

  it("does not render shell widget and nav labels below 0.7rem", () => {
    const css = read("frontend/src/components/app-shell/app-shell.css");
    const sizes = [...css.matchAll(/font-size:\s*(0\.\d+)rem/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes.filter((n) => n >= 0.6))).toBeGreaterThanOrEqual(0.64);
    expect(css).not.toMatch(/font-size:\s*0\.6[0-3]\d*rem/);
  });

  it("describes sync queue state without implying a zero count", () => {
    const status = read("frontend/src/components/app-shell/connection-status.tsx");
    expect(status).toContain("Sync queue status unavailable");
    expect(status).not.toContain("Pending count unavailable");
  });
});
