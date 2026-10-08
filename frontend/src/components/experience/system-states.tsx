import type { ReactNode } from "react";

export function EmptyCatalog({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function PermissionDeniedState({
  title = "You do not have access",
  body = "This surface is not authorized for the current identity. The interface cannot grant what policy denies.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Forbidden</p>
      <h1 className="mt-3 font-display text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function OfflineState() {
  return (
    <div role="status" className="border-b border-border bg-muted/40 px-4 py-2 text-center text-xs">
      You are offline. Sherivs will use the last available shell until the network returns.
    </div>
  );
}

export function PublicCtaLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
}) {
  const cls =
    variant === "primary"
      ? "inline-flex items-center rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
      : variant === "secondary"
        ? "inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
        : "text-sm font-semibold underline-offset-4 hover:underline";
  return (
    <a
      href={href}
      className={`${cls} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
    >
      {children}
    </a>
  );
}
