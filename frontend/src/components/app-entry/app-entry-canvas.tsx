import type { ReactNode } from "react";
import "./app-entry.css";

/**
 * Shared field for splash, sign-in, and onboarding.
 *
 * Splash and sign-in use the light glass field sampled from the Sherivs
 * mark (cyan / blue / violet orbs on `#eef2f8`). The default tone still
 * paints the owner-supplied splash-field photograph. Onboarding opts into
 * the login field with `tone="login"` and `wide` so the request form can
 * sit in a two-column document instead of the lockup column.
 *
 * The backdrop class is distinct from form `.app-entry-field` labels.
 */
export function AppEntryCanvas({
  children,
  align = "center",
  tone = "splash",
  wide = false,
}: {
  children: ReactNode;
  align?: "center" | "start";
  tone?: "splash" | "login";
  /** Wider document stage. Used by onboarding; splash and sign-in stay narrow. */
  wide?: boolean;
}) {
  return (
    <div
      className={`app-entry${tone === "login" ? " app-entry-login" : ""}${wide ? " app-entry-onboarding" : ""}`}
      data-testid="app-entry-root"
      data-tone={tone}
      data-layout={wide ? "onboarding" : undefined}
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
        }${wide ? " app-entry-stage-onboarding" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
