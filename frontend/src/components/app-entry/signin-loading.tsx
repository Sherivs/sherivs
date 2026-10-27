import { SHERIVS_WORDMARK_SRC } from "@/lib/auth/signin-loading-wordmark";

/**
 * Same login field (orbs + light glass) with the official wordmark
 * written as one continuous signature, looping until the parent
 * unmounts it after Auth finishes.
 */
export function SignInLoading() {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className="app-entry-signin-loading"
      data-testid="app-entry-signin-loading"
      role="status"
      aria-live="polite"
      aria-label="Signing you in"
    >
      <div
        className={
          reduced ? "app-entry-signin-loading-word is-static" : "app-entry-signin-loading-word"
        }
        data-testid="app-entry-signin-loading-word"
      >
        <span className="sr-only">sherivs</span>
        <span className="app-entry-signin-loading-mask" aria-hidden="true">
          <img src={SHERIVS_WORDMARK_SRC} alt="" decoding="async" draggable={false} />
        </span>
      </div>
      <p className="app-entry-signin-loading-caption">Signing you in</p>
    </div>
  );
}
