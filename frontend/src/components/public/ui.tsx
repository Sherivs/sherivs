import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type CapabilityStatus } from "@/lib/public-site/capabilities";
import { PublicLink } from "@/components/public/public-link";

export function PageContainer({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        "px-[var(--sherivs-gutter)]",
        wide ? "max-w-[var(--sherivs-container-wide)]" : "max-w-[var(--sherivs-container)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function GlassPanel({
  children,
  className,
  enter = false,
}: {
  children: ReactNode;
  className?: string;
  enter?: boolean;
}) {
  return (
    <div
      className={cn(
        "sherivs-glass-card rounded-[var(--sherivs-radius-lg)] p-6 sm:p-8",
        enter && "sherivs-enter",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Section({
  id,
  labelledBy,
  children,
  className,
  tone = "default",
}: {
  id?: string;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted" | "full" | "paper";
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("relative z-[1]", tone === "paper" && "sherivs-surface-light", className)}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="sherivs-kicker">{children}</p>;
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="sherivs-display mt-3 text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {lead ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
          {lead}
        </p>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: CapabilityStatus }) {
  const tone =
    status === "available"
      ? "border-sherivs-cyan/40 bg-sherivs-cyan/10 text-sherivs-cyan"
      : status === "in_development"
        ? "border-sherivs-warning/40 bg-sherivs-warning/10 text-sherivs-warning"
        : "border-[var(--sherivs-border-strong)] bg-white/5 text-sherivs-muted";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest",
        tone,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function FeatureCard({
  title,
  children,
  href,
  status,
  className,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  status?: CapabilityStatus;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-sherivs-muted">{children}</div>
    </>
  );
  const cls = cn(
    "sherivs-glass-card rounded-[var(--sherivs-radius)] p-5 transition-transform duration-[var(--sherivs-motion-fast)]",
    href && "block hover:-translate-y-0.5",
    className,
  );
  if (href) {
    return (
      <PublicLink href={href} className={cls}>
        {inner}
      </PublicLink>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function PartnerCard({
  name,
  summary,
  href,
  kindLabel,
  logoSrc,
}: {
  name: string;
  summary?: string;
  href?: string;
  kindLabel: string;
  logoSrc?: string;
}) {
  return (
    <article className="sherivs-glass-card rounded-[var(--sherivs-radius)] p-5">
      {logoSrc ? (
        <div className="flex h-28 items-center justify-center rounded-[var(--sherivs-radius-sm)] bg-white p-4">
          <img src={logoSrc} alt="" className="max-h-24 w-auto max-w-full object-contain" />
        </div>
      ) : null}
      <p className={`sherivs-kicker ${logoSrc ? "mt-4" : ""}`}>{kindLabel}</p>
      <h3 className="mt-2 font-display text-lg font-semibold">{name}</h3>
      {summary ? (
        <p className="mt-2 text-sm leading-relaxed text-sherivs-muted">{summary}</p>
      ) : null}
      {href ? (
        <a
          href={href}
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-sherivs-cyan underline-offset-4 hover:underline"
        >
          {href.replace(/^https?:\/\//, "")}
        </a>
      ) : null}
    </article>
  );
}

export function Callout({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <aside
      className={cn(
        "rounded-[var(--sherivs-radius)] border p-4 text-sm leading-relaxed",
        tone === "warning"
          ? "border-sherivs-warning/40 bg-sherivs-warning/5 text-[var(--sherivs-ink-muted)]"
          : "sherivs-glass-card text-[var(--sherivs-ink-muted)]",
      )}
    >
      <p className="font-semibold text-[var(--sherivs-ink)]">{title}</p>
      <div className="mt-2">{children}</div>
    </aside>
  );
}

export function PublicButton({
  href,
  children,
  variant = "primary",
  className,
  type,
  disabled,
  loading,
  onClick,
}: {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    "inline-flex min-h-11 items-center justify-center rounded-[var(--sherivs-radius-sm)] px-5 py-2.5 text-center text-sm font-semibold transition-[opacity,transform,filter] duration-[var(--sherivs-motion-fast)] disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary" && "sherivs-btn-primary",
    variant === "secondary" && "sherivs-btn-secondary",
    variant === "text" && "sherivs-btn-text px-0",
    className,
  );
  const label = loading ? "Working…" : children;
  if (href) {
    if (href.startsWith("mailto:") || href.startsWith("http")) {
      return (
        <a href={href} className={cls} onClick={onClick}>
          {label}
        </a>
      );
    }
    return (
      <Link to={href as never} className={cls} onClick={onClick}>
        {label}
      </Link>
    );
  }
  return (
    <button
      type={type ?? "button"}
      className={cls}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function Breadcrumbs({ items }: { items: readonly { href: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-sherivs-muted">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {index === items.length - 1 ? (
              <span aria-current="page" className="text-[var(--sherivs-ink)]">
                {item.label}
              </span>
            ) : (
              <Link to={item.href as never} className="hover:text-[var(--sherivs-ink)]">
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHero({
  eyebrow,
  title,
  lead,
  actions,
  id = "page-hero",
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <PageContainer className="py-10 sm:py-14">
      <GlassPanel enter className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          id={id}
          className="sherivs-display sherivs-enter-2 mt-3 max-w-3xl text-3xl font-bold sm:text-5xl"
        >
          {title}
        </h1>
        {lead ? (
          <p className="sherivs-enter-3 mt-5 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-lg">
            {lead}
          </p>
        ) : null}
        {actions ? (
          <div className="sherivs-enter-4 mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div>
        ) : null}
      </GlassPanel>
    </PageContainer>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-sherivs-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-sherivs-warning">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-[var(--sherivs-radius-sm)] border border-[var(--sherivs-border)] bg-white/78 px-3 text-sm text-[var(--sherivs-ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-md placeholder:text-[#9aa3b8]";
