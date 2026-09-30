// ─── CoreGrid Phase 23 — Web Platform ───────────────────────────────
// web-platform.ts — Accessibility, keyboard, error boundaries, observability
// ──────────────────────────────────────────────────────────────────────
// Sections: AN, AO, AP, AQ, BE, BF, BG, BH, BI, BD, BC, BW, BX, BY

export type WCAGLevel = "A" | "AA" | "AAA";

export interface WebAccessibilityConfig {
  readonly wcagLevel: WCAGLevel;
  readonly ariaRequired: boolean;
  readonly keyboardNavigation: boolean;
  readonly focusManagement: boolean;
  readonly skipLinks: boolean;
  readonly screenReaderSupport: boolean;
  readonly colorContrast: boolean;
  readonly reducedMotionSupport: boolean;
}

export interface KeyboardConfig {
  readonly globalShortcuts: boolean;
  readonly commandPalette: boolean;
  readonly tabNavigation: boolean;
  readonly arrowKeyNavigation: boolean;
  readonly escapeCloses: boolean;
  readonly shortcutModifier: "ctrl" | "cmd" | "ctrl+shift" | "none";
}

export interface WebErrorBoundary {
  readonly id: string;
  readonly componentName: string;
  readonly fallbackComponent: string;
  readonly resetOnRetry: boolean;
  readonly logErrors: boolean;
  readonly showStackTrace: boolean;
}

export interface WebErrorPage {
  readonly statusCode: number;
  readonly title: string;
  readonly description: string;
  readonly showHomeButton: boolean;
  readonly showRetryButton: boolean;
  readonly trackingCategory: string;
}

export interface WebObservabilityConfig {
  readonly performanceMonitoring: boolean;
  readonly errorTracking: boolean;
  readonly userTiming: boolean;
  readonly customMetrics: boolean;
  readonly sessionReplay: boolean;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly sampleRate: number;
}

export interface WebSecurityTelemetry {
  readonly cspViolations: number;
  readonly xssAttempts: number;
  readonly csrfAttempts: number;
  readonly authFailures: number;
  readonly suspiciousRequests: number;
  readonly lastReported: string;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createAccessibilityConfig(level?: WCAGLevel): WebAccessibilityConfig {
  const lvl = level ?? "AA";
  return {
    wcagLevel: lvl,
    ariaRequired: true,
    keyboardNavigation: true,
    focusManagement: true,
    skipLinks: true,
    screenReaderSupport: true,
    colorContrast: true,
    reducedMotionSupport: true,
  };
}

export function createErrorBoundary(params: {
  id: string;
  componentName: string;
  fallbackComponent: string;
}): WebErrorBoundary {
  if (!params.id || !params.componentName)
    throw new Error("Error boundary requires id and component name");
  return {
    id: params.id,
    componentName: params.componentName,
    fallbackComponent: params.fallbackComponent,
    resetOnRetry: true,
    logErrors: true,
    showStackTrace: false,
  };
}

export function createErrorPage(statusCode: number): WebErrorPage {
  const pages: Record<number, { title: string; description: string }> = {
    404: { title: "Page Not Found", description: "The page you're looking for doesn't exist" },
    403: { title: "Access Denied", description: "You don't have permission to access this page" },
    500: { title: "Server Error", description: "Something went wrong. Please try again" },
    503: { title: "Service Unavailable", description: "The service is temporarily unavailable" },
  };
  const page = pages[statusCode] ?? { title: "Error", description: "An unexpected error occurred" };
  return {
    statusCode,
    ...page,
    showHomeButton: true,
    showRetryButton: statusCode >= 500,
    trackingCategory: `error_${statusCode}`,
  };
}

export function checkARIACompliance(roles: Record<string, boolean>): {
  compliant: boolean;
  violations: string[];
} {
  const violations = Object.entries(roles)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { compliant: violations.length === 0, violations };
}
