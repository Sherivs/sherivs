/**
 * Personal experience preferences stored on-device.
 *
 * These never grant authorization. They only tune presentation: motion,
 * density, and contrast. Theme remains in `@/lib/theme`.
 */
export type MotionPreference = "system" | "full" | "reduced";
export type DensityPreference = "comfortable" | "compact";
export type ContrastPreference = "standard" | "high";

const MOTION_KEY = "sherivs:motion";
const DENSITY_KEY = "sherivs:density";
const CONTRAST_KEY = "sherivs:contrast";

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
}

export function readMotionPreference(): MotionPreference {
  return readEnum(MOTION_KEY, ["system", "full", "reduced"] as const, "system");
}

export function readDensityPreference(): DensityPreference {
  return readEnum(DENSITY_KEY, ["comfortable", "compact"] as const, "comfortable");
}

export function readContrastPreference(): ContrastPreference {
  return readEnum(CONTRAST_KEY, ["standard", "high"] as const, "standard");
}

export function applyExperiencePreferences(options?: {
  motion?: MotionPreference;
  density?: DensityPreference;
  contrast?: ContrastPreference;
}) {
  if (typeof document === "undefined") return;
  const motion = options?.motion ?? readMotionPreference();
  const density = options?.density ?? readDensityPreference();
  const contrast = options?.contrast ?? readContrastPreference();
  const root = document.documentElement;

  const reduce =
    motion === "reduced" ||
    (motion === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  root.dataset.sherivsMotion = reduce ? "reduced" : "full";
  root.dataset.sherivsDensity = density;
  root.dataset.sherivsContrast = contrast;
  root.classList.toggle("sherivs-reduced-motion", reduce);
  root.classList.toggle("sherivs-compact", density === "compact");
  root.classList.toggle("sherivs-high-contrast", contrast === "high");
}

export function setMotionPreference(value: MotionPreference) {
  if (typeof window !== "undefined") window.localStorage.setItem(MOTION_KEY, value);
  applyExperiencePreferences({ motion: value });
}

export function setDensityPreference(value: DensityPreference) {
  if (typeof window !== "undefined") window.localStorage.setItem(DENSITY_KEY, value);
  applyExperiencePreferences({ density: value });
}

export function setContrastPreference(value: ContrastPreference) {
  if (typeof window !== "undefined") window.localStorage.setItem(CONTRAST_KEY, value);
  applyExperiencePreferences({ contrast: value });
}

export const EXPERIENCE_PREFERENCE_BOOTSTRAP_SCRIPT = `(function(){try{var m=localStorage.getItem('${MOTION_KEY}')||'system';var d=localStorage.getItem('${DENSITY_KEY}')||'comfortable';var c=localStorage.getItem('${CONTRAST_KEY}')||'standard';var r=document.documentElement;var reduce=m==='reduced'||(m==='system'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);r.dataset.sherivsMotion=reduce?'reduced':'full';r.dataset.sherivsDensity=d;r.dataset.sherivsContrast=c;r.classList.toggle('sherivs-reduced-motion',reduce);r.classList.toggle('sherivs-compact',d==='compact');r.classList.toggle('sherivs-high-contrast',c==='high');}catch(e){}})();`;
