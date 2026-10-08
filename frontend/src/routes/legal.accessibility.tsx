import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { Eye, Keyboard, Sparkles, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/legal/accessibility")({
  component: LegalAccessibilityPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Institutional Accessibility Statement` },
      {
        name: "description",
        content: `WCAG 2.2 AA+ conformance standards, keyboard navigation, screen reader ergonomics, and inclusive design commitments for ${PLATFORM_NAME}.`,
      },
    ],
  }),
});

function LegalAccessibilityPage() {
  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Inclusive Architecture</span>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">
          Institutional Accessibility Statement
        </h1>
        <p className="mt-2 text-xs font-mono text-muted-foreground">Standard: WCAG 2.2 Level AA / Section 508 • October 2026</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
          <Keyboard className="size-4 text-cyan-400 mb-2" />
          <h2 className="text-xs font-semibold text-foreground">100% Keyboard Operable</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete focus trap management, skip links, and universal ⌘K command interface access.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
          <Eye className="size-4 text-emerald-400 mb-2" />
          <h2 className="text-xs font-semibold text-foreground">High-Contrast Radiance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All text meets or exceeds 4.5:1 contrast ratios across both deep dark and luminous light modes.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
          <Sparkles className="size-4 text-violet-400 mb-2" />
          <h2 className="text-xs font-semibold text-foreground">Reduced Motion Native</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Respects system <code className="font-mono text-[11px]">prefers-reduced-motion</code> flags, eliminating all non-essential kinetic transitions.
          </p>
        </div>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed border-t border-border/60 pt-6">
        <section>
          <h2 className="text-base font-bold text-foreground">1. Architectural Commitment</h2>
          <p className="mt-2">
            {PLATFORM_NAME} is committed to delivering digital experiences that are fully accessible to all university leaders, faculty members, researchers, students, and campus visitors, regardless of physical or cognitive ability. We audit our entire design system against the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA and Section 508 of the U.S. Rehabilitation Act.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">2. Screen Reader Ergonomics</h2>
          <p className="mt-2">
            Every interactive surface—including the Jarvis executive drawer, bitemporal timelines, and data tables—includes semantic ARIA landmarks (<code className="font-mono text-xs">role="dialog"</code>, <code className="font-mono text-xs">aria-live="polite"</code>, <code className="font-mono text-xs">aria-expanded</code>). Dynamic AI observations and streaming tokens are announced without interrupting active screen reader focus.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">3. Continuous Automated & Assistive Testing</h2>
          <p className="mt-2">
            Our continuous integration pipeline validates component trees using automated axe-core accessibility scanners. In addition, real-world assistive testing is conducted across NVDA, VoiceOver (macOS and iOS), and JAWS screen reading environments.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">4. Feedback & Assistive Support</h2>
          <p className="mt-2">
            If you encounter any accessibility barrier or have specific assistive requirements, please contact our accessibility engineering team at <span className="font-mono text-cyan-400">accessibility@sherivs.com</span>. We provide prompt remediation within 72 business hours.
          </p>
        </section>
      </div>
    </div>
  );
}
