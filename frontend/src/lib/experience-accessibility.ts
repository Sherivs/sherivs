// ─── CoreGrid Phase 24 — Experience & Design Intelligence ────────────
// experience-accessibility.ts — Accessibility system, motion, loading,
//                               empty states, offline, onboarding, help
// ──────────────────────────────────────────────────────────────────────
// Sections: BL, BM, BN, BO, BP, BQ, BR, BS, BT, BU, CB, CC, CD, CE,
//           CF, DH, DI, DJ, DK, DL, DM, DN, DO, DP, DQ, DR, DS, DT,
//           DU, DV, DW, DX, DY, DZ, EA, EB, EC, ED, EE, EF, EG, EH

export type WCAGComplianceLevel = "A" | "AA" | "AAA";

export interface AccessibilitySystem {
  readonly wcagLevel: WCAGComplianceLevel;
  readonly screenReaderSupport: boolean;
  readonly keyboardNavigation: boolean;
  readonly focusIndicators: boolean;
  readonly skipLinks: boolean;
  readonly ariaRequired: boolean;
  readonly semanticHTML: boolean;
  readonly colorContrast: boolean;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly fontSizeScale: number;
}

export interface CognitiveAccessibility {
  readonly simplifiedMode: boolean;
  readonly reducedVisualClutter: boolean;
  readonly clearLanguage: boolean;
  readonly consistentNavigation: boolean;
  readonly predictableBehavior: boolean;
  readonly errorPrevention: boolean;
  readonly helpAvailable: boolean;
}

export interface MotionSystem {
  readonly reducedMotion: boolean;
  readonly animationsEnabled: boolean;
  readonly transitionDuration: "none" | "fast" | "normal" | "slow";
  readonly parallaxEnabled: boolean;
  readonly hapticsEnabled: boolean;
}

export interface Microinteraction {
  readonly id: string;
  readonly trigger: "hover" | "click" | "focus" | "drag" | "swipe" | "long_press";
  readonly feedback: "color" | "scale" | "position" | "opacity" | "sound" | "haptic";
  readonly duration: number;
}

export interface LoadingExperience {
  readonly type: "skeleton" | "spinner" | "progress_bar" | "skeleton_text" | "shimmer";
  readonly showProgress: boolean;
  readonly timeout: number;
  readonly fallbackMessage: string | null;
}

export interface EmptyState {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly actionLabel: string | null;
  readonly actionRoute: string | null;
}

export interface OfflineExperience {
  readonly showBanner: boolean;
  readonly showQueueCount: boolean;
  readonly enableOfflineMode: boolean;
  readonly syncOnReconnect: boolean;
  readonly showStaleIndicator: boolean;
}

export interface OnboardingFlow {
  readonly id: string;
  readonly steps: { title: string; description: string; target: string | null }[];
  readonly required: boolean;
  readonly skipable: boolean;
  readonly progressTracking: boolean;
  readonly tooltipStyle: "popover" | "highlight" | "step_modal";
}

export interface ContextualHelp {
  readonly inlineHelp: boolean;
  readonly tooltips: boolean;
  readonly helpCenter: boolean;
  readonly contextualDocs: boolean;
  readonly aiAssistance: boolean;
  readonly feedbackLink: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createAccessibilitySystem(level?: WCAGComplianceLevel): AccessibilitySystem {
  return {
    wcagLevel: level ?? "AA",
    screenReaderSupport: true,
    keyboardNavigation: true,
    focusIndicators: true,
    skipLinks: true,
    ariaRequired: true,
    semanticHTML: true,
    colorContrast: true,
    reducedMotion: true,
    highContrast: true,
    fontSizeScale: 1,
  };
}

export function createEmptyState(params: {
  title: string;
  description: string;
  icon: string;
  actionLabel?: string;
  actionRoute?: string;
}): EmptyState {
  return {
    title: params.title,
    description: params.description,
    icon: params.icon,
    actionLabel: params.actionLabel ?? null,
    actionRoute: params.actionRoute ?? null,
  };
}

export function createOnboardingFlow(params: {
  id: string;
  steps: { title: string; description: string; target: string | null }[];
  required?: boolean;
  skipable?: boolean;
}): OnboardingFlow {
  return {
    id: params.id,
    steps: params.steps,
    required: params.required ?? false,
    skipable: params.skipable ?? true,
    progressTracking: true,
    tooltipStyle: "popover",
  };
}

export function getLoadingExperience(type: LoadingExperience["type"]): LoadingExperience {
  return {
    type,
    showProgress: type === "progress_bar",
    timeout: 30000,
    fallbackMessage: type === "spinner" ? "Loading..." : null,
  };
}

export function createMotionSystem(reducedMotion: boolean): MotionSystem {
  return {
    reducedMotion,
    animationsEnabled: !reducedMotion,
    transitionDuration: reducedMotion ? "none" : "normal",
    parallaxEnabled: !reducedMotion,
    hapticsEnabled: true,
  };
}

export function checkColorContrast(
  foreground: string,
  background: string,
): { passes: boolean; ratio: number } {
  // Simplified WCAG AA contrast check (4.5:1 for normal text)
  const hexToLuminance = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const linearize = (c: number) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  };
  const l1 = hexToLuminance(foreground);
  const l2 = hexToLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return { passes: ratio >= 4.5, ratio: Math.round(ratio * 100) / 100 };
}
