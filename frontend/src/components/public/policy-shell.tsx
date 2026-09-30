/**
 * Minimal dark shell used by /privacy and /rules public pages.
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
    <div
      className="min-h-dvh text-white"
      style={{ background: "linear-gradient(180deg, #0a0f1e 0%, #0d1424 100%)" }}
    >
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        {schoolName && (
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-slate-400 hover:text-white"
          >
            ← {schoolName}
          </Link>
        )}
        <h1 className="mt-6 font-display text-3xl md:text-5xl font-extrabold">{title}</h1>
        <div className="mt-8">{children}</div>
      </article>
    </div>
  );
}

export function PolicySkeleton({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] p-8">
      <span className="inline-block rounded-full bg-[var(--tenant-primary,#3b82f6)]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--tenant-primary,#3b82f6)]">
        [ {label} ]
      </span>
      <p className="mt-6 text-sm text-slate-400">{body}</p>
    </div>
  );
}
