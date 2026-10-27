import type { ReactNode } from "react";
import "./app-entry.css";

/**
 * Shared field for splash, sign-in, and onboarding.
 *
 * The app splash and sign-in share the light glass field sampled from the
 * Sherivs mark (cyan / blue / violet orbs on `#eef2f8`). Onboarding still
 * uses the owner-supplied splash-field photograph. Foreground chrome stays
 * in `.app-entry-stage`.
 *
 * The backdrop class is distinct from form `.app-entry-field` labels.
 */
export function AppEntryCanvas({
  children,
  align = "center",
  tone = "splash",
}: {
  children: ReactNode;
  align?: "center" | "start";
  tone?: "splash" | "login";
}) {
  return (
    <div
      className={`app-entry${tone === "login" ? " app-entry-login" : ""}`}
      data-testid="app-entry-root"
      data-tone={tone}
    >
      {tone === "login" ? (
        <div className="app-entry-login-orbs" aria-hidden="true">
          <span className="app-entry-orb app-entry-orb-cyan" />
          <span className="app-entry-orb app-entry-orb-blue" />
          <span className="app-entry-orb app-entry-orb-violet" />
        </div>
      ) : (
        <div className="app-entry-backdrop" aria-hidden="true">
          <img
            src="/app-entry/splash-field.jpg"
            alt=""
            decoding="async"
            fetchPriority="high"
            draggable={false}
          />
        </div>
      )}
      <div
        className={`app-entry-stage${align === "start" ? " app-entry-stage-start" : ""}${
          tone === "login" ? " app-entry-stage-login" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
