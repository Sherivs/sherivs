import { useEffect, useState } from "react";
import {
  SHERIVS_WORDMARK_SRC,
  nextSherivsLoadingPhase,
  sherivsRevealAt,
  sherivsVisibleWord,
} from "@/lib/auth/signin-loading-wordmark";

/**
 * Same login field (orbs + light glass) with the official wordmark typed
 * s-h-e-r-i-v-s, looping until the parent unmounts it after Auth finishes.
 */
export function SignInLoading() {
  const [visible, setVisible] = useState(0);
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      setVisible(7);
      return;
    }
    let phase = 0;
    let timer = 0;
    const tick = () => {
      const next = nextSherivsLoadingPhase(phase);
      phase = next.phase;
      setVisible(next.visible);
      timer = window.setTimeout(tick, next.delayMs);
    };
    timer = window.setTimeout(tick, 70);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  const reveal = reduced ? 1 : sherivsRevealAt(visible);
  const spoken = sherivsVisibleWord(visible) || "Signing you in";

  return (
    <div
      className="app-entry-signin-loading"
      data-testid="app-entry-signin-loading"
      role="status"
      aria-live="polite"
      aria-label="Signing you in"
    >
      <div
        className="app-entry-signin-loading-word"
        style={{ ["--sherivs-reveal" as string]: String(reveal) }}
        data-testid="app-entry-signin-loading-word"
        data-reveal={reveal}
        data-letters={visible}
      >
        <span className="sr-only">{spoken}</span>
        <span className="app-entry-signin-loading-mask" aria-hidden="true">
          <img src={SHERIVS_WORDMARK_SRC} alt="" decoding="async" draggable={false} />
        </span>
      </div>
      <p className="app-entry-signin-loading-caption">Signing you in</p>
    </div>
  );
}
