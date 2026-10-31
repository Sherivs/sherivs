import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/security/turnstile-config";

/**
 * Cloudflare Turnstile widget, feature-flagged by VITE_TURNSTILE_SITE_KEY.
 *
 * Fail-open on the client by design:
 *  - key unset            -> renders nothing, callers send no captchaToken;
 *  - script fails to load -> onUnavailable() fires so callers can still submit
 *    (Supabase is the enforcer: if captcha is enabled there it rejects the
 *    request, otherwise sign-in works as before).
 * The client never blocks a login on its own; only Supabase Auth's captcha
 * setting does. See docs/ops/AUTH-SECURITY-SETUP.md for the rollout order.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 10_000;
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    const timer = setTimeout(() => {
      scriptPromise = null;
      reject(new Error("Captcha load timed out"));
    }, LOAD_TIMEOUT_MS);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      scriptPromise = null;
      reject(new Error("Could not load the captcha"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function Turnstile({
  onToken,
  onUnavailable,
  resetKey,
}: {
  onToken: (token: string | null) => void;
  /** Called when the widget cannot load or errors; callers should stop requiring a token. */
  onUnavailable?: () => void;
  /** Change this value to force a fresh challenge (tokens are single-use). */
  resetKey?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  const unavailable = useRef(onUnavailable);
  cb.current = onToken;
  unavailable.current = onUnavailable;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let id: string | undefined;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    cb.current(null);

    const slotWidth = (host: HTMLDivElement) => host.parentElement?.clientWidth ?? host.clientWidth;

    const renderWidget = (host: HTMLDivElement) => {
      if (cancelled || !window.turnstile) return;
      id = window.turnstile.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        // Long 65px bar only: flexible when the card is wide enough, otherwise
        // the 300×65 normal widget scaled to the field width. Never the square.
        size: turnstileSize(slotWidth(host)),
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(null),
        "error-callback": () => {
          cb.current(null);
          unavailable.current?.();
        },
      });
      applyTurnstileBarFit(host, slotWidth(host));
    };

    loadScript()
      .then(() => {
        const host = ref.current;
        if (cancelled || !host || !window.turnstile) return;
        let rendered = false;
        const sync = () => {
          if (cancelled || slotWidth(host) < 1) return;
          if (!rendered) {
            rendered = true;
            renderWidget(host);
          } else {
            applyTurnstileBarFit(host, slotWidth(host));
          }
        };
        observer = new ResizeObserver(sync);
        observer.observe(host.parentElement ?? host);
        sync();
      })
      .catch(() => {
        cb.current(null);
        unavailable.current?.();
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="turnstile-slot" data-testid="turnstile-slot">
      <div ref={ref} className="turnstile-host" data-testid="turnstile" />
    </div>
  );
}

export const TURNSTILE_BAR_WIDTH = 300;
export const TURNSTILE_BAR_HEIGHT = 65;

/** Long rectangle only. Compact (square) is never used. */
export function turnstileSize(containerWidth = 0): "flexible" | "normal" {
  return containerWidth >= TURNSTILE_BAR_WIDTH ? "flexible" : "normal";
}

/** Scale the 300×65 bar down so it fits a narrower card without clipping. */
export function turnstileBarScale(containerWidth: number): number {
  if (containerWidth <= 0 || containerWidth >= TURNSTILE_BAR_WIDTH) return 1;
  return containerWidth / TURNSTILE_BAR_WIDTH;
}

export function applyTurnstileBarFit(host: HTMLElement, containerWidth: number): void {
  const scale = turnstileBarScale(containerWidth);
  if (scale < 1) {
    host.style.width = `${TURNSTILE_BAR_WIDTH}px`;
    host.style.transform = `scale(${scale})`;
    host.style.transformOrigin = "top left";
    host.style.marginBottom = `${TURNSTILE_BAR_HEIGHT * (scale - 1)}px`;
  } else {
    host.style.width = "";
    host.style.transform = "";
    host.style.transformOrigin = "";
    host.style.marginBottom = "";
  }
}

/** True when the form must wait for a token before submitting. */
export function captchaRequired(enabled: boolean, token: string | null, unavailable: boolean): boolean {
  return enabled && !token && !unavailable;
}
