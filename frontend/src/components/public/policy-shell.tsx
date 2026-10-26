/**
 * Minimal public content shell for tenant leftover pages (privacy, rules,
 * blog, news, events). Replaces the Lovable navy-gradient prototype chrome.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
    <PublicContentShell>
      {schoolName && (
        <Link
          to="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← {schoolName}
        </Link>
      )}
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight md:text-5xl">{title}</h1>
      <div className="mt-8">{children}</div>
    </PublicContentShell>
  );
}

export function PolicySkeleton({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-muted/20 p-8">
      <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
        [ {label} ]
      </span>
      <p className="mt-6 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** Shared article/list chrome for leftover tenant public pages. */
export function PublicContentShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <article className={`mx-auto px-6 py-16 md:py-24 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
        {children}
      </article>
    </div>
  );
}
