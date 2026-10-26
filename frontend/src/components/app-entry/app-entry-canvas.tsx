import type { ReactNode } from "react";
import "./app-entry.css";

/**
 * Shared cinematic field for splash, sign-in, and onboarding.
 * Decorative waves are aria-hidden; motion is CSS-only and respects
 * prefers-reduced-motion in app-entry.css.
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
      <div className="app-entry-aurora" aria-hidden="true" />
      <div className="app-entry-waves" aria-hidden="true">
        <svg viewBox="0 0 1440 720" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="app-entry-g-a" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#1848fd" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#14a8fc" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#2f6dff" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="app-entry-g-b" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#8254f6" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#4b3dff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#1848fd" stopOpacity="0.12" />
            </linearGradient>
            <linearGradient id="app-entry-g-c" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#246bfd" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#8254f6" stopOpacity="0.3" />
            </linearGradient>
            <filter id="app-entry-blur" x="-10%" y="-20%" width="120%" height="140%">
              <feGaussianBlur stdDeviation="22" />
            </filter>
          </defs>
          <g className="app-entry-wave-c" filter="url(#app-entry-blur)">
            <path fill="url(#app-entry-g-c)" d="M-80 420 C 220 330, 480 520, 760 410 S 1180 280, 1520 390 V 760 H -80 Z" />
          </g>
          <g className="app-entry-wave-a">
            <path fill="url(#app-entry-g-a)" d="M-120 490 C 180 390, 420 580, 720 470 S 1120 330, 1560 470 V 780 H -120 Z" />
          </g>
          <g className="app-entry-wave-b">
            <path fill="url(#app-entry-g-b)" d="M520 560 C 780 480, 980 640, 1200 540 S 1400 470, 1560 530 V 800 H 520 Z" />
          </g>
        </svg>
      </div>
      <div className={`app-entry-stage${align === "start" ? " app-entry-stage-start" : ""}`}>{children}</div>
    </div>
  );
}
