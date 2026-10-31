/**
 * Post-credential sign-in loading: the official lowercase “sherivs”
 * wordmark writes once as a continuous signature, then fades and
 * writes again until auth finishes. Timing lives here; the stroke
 * itself is CSS so the clip never snaps.
 */

export const SHERIVS_LOADING_LETTERS = ["s", "h", "e", "r", "i", "v", "s"] as const;

export const SHERIVS_WORDMARK_SRC = "/brand/sherivs-app-wordmark.png";

/** One continuous left-to-right write (matches CSS 70% of the loop). */
export const SHERIVS_WRITE_MS = 1960;
export const SHERIVS_HOLD_MS = 450;
export const SHERIVS_FADE_MS = 390;
export const SHERIVS_LOOP_MS = SHERIVS_WRITE_MS + SHERIVS_HOLD_MS + SHERIVS_FADE_MS;

/** Show at least one complete write so a fast Auth response still lands cleanly. */
export const SHERIVS_LOADING_FLOOR_MS = SHERIVS_WRITE_MS + SHERIVS_HOLD_MS;

export function signInLoadingRemainingMs(startedAt: number, now: number, floorMs = SHERIVS_LOADING_FLOOR_MS): number {
  return Math.max(0, floorMs - Math.max(0, now - startedAt));
}
