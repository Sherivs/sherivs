import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type CapabilityStatus } from "@/lib/public-site/capabilities";

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
        "mx-auto w-full px-4 sm:px-6",
        wide ? "max-w-[var(--sherivs-container-wide)]" : "max-w-[var(--sherivs-container)]",
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
  tone?: "default" | "muted" | "full";
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "border-b border-[var(--sherivs-border)]",
        tone === "muted" && "bg-[color-mix(in_oklab,var(--sherivs-midnight)_70%,transparent)]",
        tone === "full" && "bg-[var(--sherivs-midnight)]",
        className,
      )}
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
    "rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] bg-[color-mix(in_oklab,var(--sherivs-midnight)_55%,transparent)] p-5 transition-colors",
    href && "block hover:border-[var(--sherivs-glass-border)] hover:bg-[var(--sherivs-navy)]",
    className,
  );
  if (href) {
    return (
      <Link to={href as never} className={cls}>
        {inner}
      </Link>
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
    <article className="rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] bg-[color-mix(in_oklab,var(--sherivs-midnight)_55%,transparent)] p-5">
      {logoSrc ? (
        <div className="flex h-28 items-center justify-center rounded-[var(--sherivs-radius-sm)] bg-white p-4">
          <img src={logoSrc} alt="" className="max-h-24 w-auto max-w-full object-contain" />
        </div>
      ) : null}
      <p className={`sherivs-kicker ${logoSrc ? "mt-4" : ""}`}>{kindLabel}</p>
      <h3 className="mt-2 font-display text-lg font-semibold">{name}</h3>
      {summary ? <p className="mt-2 text-sm leading-relaxed text-sherivs-muted">{summary}</p> : null}
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
          ? "border-sherivs-warning/40 bg-sherivs-warning/5 text-sherivs-muted"
          : "border-[var(--sherivs-glass-border)] bg-[var(--sherivs-glass)] text-sherivs-muted",
      )}
    >
      <p className="font-semibold text-sherivs-white">{title}</p>
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
    "inline-flex min-h-11 items-center justify-center rounded-[var(--sherivs-radius-sm)] px-5 py-2.5 text-center text-sm font-semibold transition-opacity",
    variant === "primary" &&
      "bg-sherivs-blue text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
    variant === "secondary" &&
      "border border-[var(--sherivs-border-strong)] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50",
    variant === "text" && "px-0 text-sherivs-cyan underline-offset-4 hover:underline",
    className,
  );
  const label = loading ? "Working…" : children;
  if (href) {
    if (href.startsWith("mailto:") || href.startsWith("http")) {
      return (
        <a href={href} className={cls}>
          {label}
        </a>
      );
    }
    return (
      <Link to={href as never} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <button type={type ?? "button"} className={cls} disabled={disabled || loading} onClick={onClick}>
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
              <span aria-current="page" className="text-sherivs-white">
                {item.label}
              </span>
            ) : (
              <Link to={item.href as never} className="hover:text-sherivs-white">
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
    <div className="border-b border-[var(--sherivs-border)]">
      <PageContainer className="py-14 sm:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 id={id} className="sherivs-display mt-3 max-w-3xl text-3xl font-bold sm:text-5xl">
          {title}
        </h1>
        {lead ? (
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-lg">
            {lead}
          </p>
        ) : null}
        {actions ? <div className="mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
      </PageContainer>
    </div>
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
  "min-h-11 w-full rounded-[var(--sherivs-radius-sm)] border border-[var(--sherivs-border-strong)] bg-[var(--sherivs-midnight)] px-3 text-sm text-sherivs-white placeholder:text-sherivs-muted/70";
