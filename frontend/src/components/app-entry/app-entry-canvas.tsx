import type { ReactNode } from "react";
import "./app-entry.css";

/**
 * Shared field for splash, sign-in, and onboarding.
 *
 * The background is the owner-supplied splash-field photograph
 * (`public/app-entry/splash-field.jpg`) — the visual source of truth —
 * not a substitute SVG. Foreground chrome stays in `.app-entry-stage`.
 *
 * The backdrop class is distinct from form `.app-entry-field` labels.
 */
export function AppEntryCanvas({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className="app-entry" data-testid="app-entry-root">
      <div className="app-entry-backdrop" aria-hidden="true">
        <img
          src="/app-entry/splash-field.jpg"
          alt=""
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />
      </div>
      <div className={`app-entry-stage${align === "start" ? " app-entry-stage-start" : ""}`}>{children}</div>
    </div>
  );
}
