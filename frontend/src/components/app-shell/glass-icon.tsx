import type { ReactNode } from "react";

export function ShellGlassIcon({
  children,
  size = 36,
  active = false,
  tone = "light",
  className,
}: {
  children: ReactNode;
  size?: number;
  active?: boolean;
  tone?: "light" | "dark" | "accent";
  className?: string;
}) {
  const classes = [
    "app-shell-glass-icon",
    active ? "is-active" : "",
    tone === "dark" ? "is-dark" : "",
    tone === "accent" ? "is-accent" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} style={{ width: size, height: size }} aria-hidden="true">
      {children}
    </span>
  );
}
