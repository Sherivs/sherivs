import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTurnstileBarFit,
  turnstileBarScale,
  turnstileSize,
} from "../../frontend/src/components/security/turnstile";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("auth card layout with Turnstile (narrow phones)", () => {
  it("uses the long bar: flexible when it fits, 300px normal below that, never compact", () => {
    expect(turnstileSize(300)).toBe("flexible");
    expect(turnstileSize(420)).toBe("flexible");
    expect(turnstileSize(299)).toBe("normal");
    expect(turnstileSize(0)).toBe("normal");
    expect(turnstileSize()).toBe("normal");
  });

  it("scales the 300px bar to the card width instead of clipping", () => {
    expect(turnstileBarScale(300)).toBe(1);
    expect(turnstileBarScale(150)).toBe(0.5);
    const host = { style: {} as Record<string, string> };
    applyTurnstileBarFit(host as unknown as HTMLElement, 150);
    expect(host.style.transform).toBe("scale(0.5)");
    expect(host.style.width).toBe("300px");
    applyTurnstileBarFit(host as unknown as HTMLElement, 360);
    expect(host.style.transform).toBe("");
  });

  it("renders Turnstile with an explicit size inside an overflow-safe slot", () => {
    const t = read("frontend/src/components/security/turnstile.tsx");
    expect(t).toContain("size: turnstileSize(");
    expect(t).toContain('className="turnstile-slot"');
    expect(t).not.toMatch(/size:\s*"compact"/);
    expect(t).not.toContain('"compact"');
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
