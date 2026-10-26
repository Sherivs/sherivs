import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { turnstileSize } from "../../frontend/src/components/security/turnstile";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("auth card layout with Turnstile (narrow phones)", () => {
  it("uses the flexible widget when it fits and compact below 300px", () => {
    expect(turnstileSize(300)).toBe("flexible");
    expect(turnstileSize(420)).toBe("flexible");
    expect(turnstileSize(299)).toBe("compact");
    expect(turnstileSize(0)).toBe("compact");
  });

  it("renders Turnstile with an explicit size inside an overflow-safe slot", () => {
    const t = read("frontend/src/components/security/turnstile.tsx");
    expect(t).toContain("size: turnstileSize(");
    expect(t).toContain('className="turnstile-slot"');
  });

  it("defines a shrinkable single-column shell and a min(100%, 28rem) border-box card", () => {
    const css = read("frontend/src/styles.css");
    expect(css).toMatch(/\.auth-shell \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.auth-card \{[^}]*box-sizing: border-box;[^}]*width: min\(100%, 28rem\)/);
    expect(css).toMatch(/\.turnstile-slot \{[^}]*max-width: 100%;[^}]*overflow: hidden/);
  });

  it("applies the shell/card to every auth page", () => {
    for (const f of ["frontend/src/routes/auth.tsx", "frontend/src/routes/forgot-password.tsx", "frontend/src/routes/reset-password.tsx"]) {
      const s = read(f);
      expect(s, f).toMatch(/className="auth-shell[\s"]/);
      expect(s, f).toContain('className="auth-card uos-card');
      expect(s, f).not.toContain("min-h-dvh grid place-items-center");
    }
  });
});
