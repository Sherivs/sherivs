/**
 * Shared layout for the five Intelligence / Command Centers.
 * Renders a hero stat strip + a grid of feature cards, each linkable
 * to a deeper view later. Frontend-only scaffolding — values are
 * presentational placeholders until real signal pipelines land.
 */
import type { ReactNode } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PortalPage, StatCard } from "@/components/portal-shell";
import { cn } from "@/lib/utils";

export type IntelStat = {
  label: string;
  value: string | number;
  hint?: string;
};

export type IntelFeature = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  metric?: { label: string; value: string };
  tone?: "emerald" | "violet" | "amber" | "sky" | "rose" | "slate";
  /** Optional deep-link target when the card is tapped. */
  href?: string;
};

const TONE: Record<NonNullable<IntelFeature["tone"]>, string> = {
  emerald: "from-emerald-500/15 to-emerald-500/0 text-emerald-200 border-emerald-400/20",
  violet: "from-violet-500/15 to-violet-500/0 text-violet-200 border-violet-400/20",
  amber: "from-amber-500/15 to-amber-500/0 text-amber-200 border-amber-400/20",
  sky: "from-sky-500/15 to-sky-500/0 text-sky-200 border-sky-400/20",
  rose: "from-rose-500/15 to-rose-500/0 text-rose-200 border-rose-400/20",
  slate: "from-slate-500/15 to-slate-500/0 text-slate-200 border-slate-400/20",
};

export function IntelligenceCenter({
  title,
  subtitle,
  tagline,
  stats,
  features,
  footer,
}: {
  title: string;
  subtitle?: string;
  tagline?: string;
  stats: IntelStat[];
  features: IntelFeature[];
  footer?: ReactNode;
}) {
  return (
    <PortalPage title={title} subtitle={subtitle}>
      {tagline && (
        <div className="uos-card flex items-start gap-3 p-4 sm:p-5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/30 to-sky-500/20 text-violet-100">
            <Sparkles className="size-4" />
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--text-secondary)] sm:text-sm">
            {tagline}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {features.map((f) => {
          const Icon = f.icon;
          const tone = TONE[f.tone ?? "slate"];
          const cardClass = cn(
            "uos-card group relative flex flex-col gap-3 overflow-hidden p-4 sm:p-5",
            "transition-transform duration-200 hover:-translate-y-0.5",
            f.href && "cursor-pointer hover:ring-1 hover:ring-white/20",
          );
          const inner = (
            <>
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60",
                  tone,
                )}
                aria-hidden
              />
              <div className="relative flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl border bg-black/20 backdrop-blur",
                    tone,
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <ArrowUpRight className="size-4 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <div className="relative space-y-1">
                <h3 className="font-display text-sm font-semibold tracking-tight sm:text-base">
                  {f.title}
                </h3>
                <p className="text-xs leading-relaxed text-[color:var(--text-secondary)]">
                  {f.description}
                </p>
              </div>
              {f.metric && (
                <div className="relative mt-auto flex items-baseline justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <span className="text-[10px] uppercase tracking-widest text-white/50">
                    {f.metric.label}
                  </span>
                  <span className="font-display text-sm font-semibold text-white">
                    {f.metric.value}
                  </span>
                </div>
              )}
            </>
          );
          if (f.href) {
            return (
              <Link key={f.title} to={f.href} className={cardClass}>
                {inner}
              </Link>
            );
          }
          return (
            <article key={f.title} className={cardClass}>
              {inner}
            </article>
          );
        })}
      </div>

      {footer}
    </PortalPage>
  );
}
