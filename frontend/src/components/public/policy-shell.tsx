/**
 * Minimal glass shell used by /privacy and /rules public pages.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PublicAtmosphere } from "@/components/public/public-atmosphere";
import { GlassPanel } from "@/components/public/ui";

export function PolicyShell({
  title,
  schoolName,
  children,
}: {
  title: string;
  schoolName?: string;
  children: ReactNode;
}) {
  return (
    <div className="sherivs-public min-h-dvh">
      <PublicAtmosphere />
      <article className="relative z-[1] mx-auto max-w-3xl px-6 py-16 md:py-24">
        <GlassPanel enter className="px-6 py-10 sm:px-10 sm:py-14">
          {schoolName && (
            <Link
              to="/"
              className="text-xs uppercase tracking-widest text-[var(--sherivs-ink-muted)] hover:text-[var(--sherivs-ink)]"
            >
              ← {schoolName}
            </Link>
          )}
          <h1 className="mt-6 font-display text-3xl font-extrabold md:text-5xl">{title}</h1>
          <div className="mt-8">{children}</div>
        </GlassPanel>
      </article>
    </div>
  );
}

export function PolicySkeleton({ label, body }: { label: string; body: string }) {
  return (
    <div className="sherivs-glass-card rounded-2xl p-8">
      <span className="inline-block rounded-full bg-[var(--tenant-primary,#3b82f6)]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--tenant-primary,#3b82f6)]">
        [ {label} ]
      </span>
      <p className="mt-6 text-sm text-[var(--sherivs-ink-muted)]">{body}</p>
    </div>
  );
}
