import type { ReactNode } from "react";
import "./app-entry.css";

/**
 * Shared cinematic field for splash, sign-in, and onboarding.
 * Decorative waves are aria-hidden; motion is CSS-only and respects
 * prefers-reduced-motion in app-entry.css.
 */
export function AppEntryCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="app-entry" data-testid="app-entry-root">
      <div className="app-entry-aurora" aria-hidden="true" />
      <div className="app-entry-waves" aria-hidden="true">
        <svg viewBox="0 0 390 640" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="app-entry-g-a" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#1848fd" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#14a8fc" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#2f6dff" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="app-entry-g-b" x1="1" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#8254f6" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#4b3dff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#1848fd" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="app-entry-g-c" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#246bfd" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#8254f6" stopOpacity="0.35" />
            </linearGradient>
            <filter id="app-entry-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="18" />
            </filter>
          </defs>
          <g className="app-entry-wave-c" filter="url(#app-entry-blur)">
            <path
              fill="url(#app-entry-g-c)"
              d="M-40 420 C 40 360, 110 500, 190 430 S 330 310, 430 380 V 680 H -40 Z"
            />
          </g>
          <g className="app-entry-wave-a">
            <path
              fill="url(#app-entry-g-a)"
              d="M-60 470 C 30 400, 90 560, 180 490 S 300 360, 420 450 V 700 H -60 Z"
            />
          </g>
          <g className="app-entry-wave-b">
            <path
              fill="url(#app-entry-g-b)"
              d="M80 560 C 160 500, 220 620, 310 540 S 400 470, 460 530 V 720 H 80 Z"
            />
          </g>
        </svg>
      </div>
      <div className="app-entry-stage">{children}</div>
    </div>
  );
}
