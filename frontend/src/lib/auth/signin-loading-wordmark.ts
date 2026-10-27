/**
 * Post-credential sign-in loading: the official lowercase “sherivs”
 * wordmark is revealed letter by letter, then written again until auth
 * finishes. Letterforms come from the owner raster — this module only
 * owns timing and clip steps.
 */

export const SHERIVS_LOADING_LETTERS = ["s", "h", "e", "r", "i", "v", "s"] as const;

/** End of each letter as a fraction of `/brand/sherivs-app-wordmark.png`. */
export const SHERIVS_LETTER_ENDS = [0.164, 0.351, 0.5, 0.584, 0.658, 0.817, 1] as const;

export const SHERIVS_WORDMARK_SRC = "/brand/sherivs-app-wordmark.png";

/** Slightly brisk type-on; a full word then a short hold. */
export const SHERIVS_LETTER_MS = 90;
export const SHERIVS_HOLD_MS = 320;
export const SHERIVS_RESET_MS = 140;
/** Show at least one complete write so a fast Auth response still lands cleanly. */
export const SHERIVS_LOADING_FLOOR_MS =
  SHERIVS_LOADING_LETTERS.length * SHERIVS_LETTER_MS + SHERIVS_HOLD_MS;

export function sherivsRevealAt(visibleLetters: number): number {
  if (visibleLetters <= 0) return 0;
  const index = Math.min(visibleLetters, SHERIVS_LETTER_ENDS.length) - 1;
  return SHERIVS_LETTER_ENDS[index] ?? 1;
}

export function sherivsVisibleWord(visibleLetters: number): string {
  if (visibleLetters <= 0) return "";
  return SHERIVS_LOADING_LETTERS.slice(0, visibleLetters).join("");
}

/**
 * Type-on clock: 1..7 letters, then a hold step (7), then 0 to restart.
 * `phase` is monotonic from the interval owner.
 */
export function nextSherivsLoadingPhase(phase: number): { phase: number; visible: number; delayMs: number } {
  const letters = SHERIVS_LOADING_LETTERS.length;
  const next = phase + 1;
  if (next <= letters) {
    return { phase: next, visible: next, delayMs: SHERIVS_LETTER_MS };
  }
  if (next === letters + 1) {
    return { phase: next, visible: letters, delayMs: SHERIVS_HOLD_MS };
  }
  return { phase: 0, visible: 0, delayMs: SHERIVS_RESET_MS };
}

export function signInLoadingRemainingMs(startedAt: number, now: number, floorMs = SHERIVS_LOADING_FLOOR_MS): number {
  return Math.max(0, floorMs - Math.max(0, now - startedAt));
}
