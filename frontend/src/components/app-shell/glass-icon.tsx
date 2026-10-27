import type { ReactNode } from "react";

export function ShellGlassIcon({
  children,
  size = 36,
  active = false,
}: {
  children: ReactNode;
  size?: number;
  active?: boolean;
}) {
  return (
    <span
      className={`app-shell-glass-icon${active ? " is-active" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
