import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 22 — Mobile Platform ─────────────────────────────
// platform-core.ts — Application shell, navigation, design system,
//                    state management, API layer, resilience, performance
// ──────────────────────────────────────────────────────────────────────

// ─── H. Client Application Shell ─────────────────────────────────────
export interface AppShellConfig {
  readonly name: string;
  readonly version: string;
  readonly buildNumber: string;
  readonly environment: "development" | "staging" | "production";
  readonly features: string[];
  readonly platformTargets: PlatformTarget[];
}

export type PlatformTarget = "ios" | "android" | "web" | "windows" | "macos" | "linux" | "tablet";
export type AppLifecycleState =
  "inactive" | "foreground" | "background" | "suspended" | "terminated";
export type AppLaunchSource =
  "user" | "push_notification" | "deep_link" | "widget" | "background_task" | "scheduled";

export interface AppLaunchContext {
  readonly source: AppLaunchSource;
  readonly deepLink: string | null;
  readonly notificationPayload: Record<string, unknown> | null;
  readonly previousState: AppLifecycleState | null;
  readonly timestamp: string;
}

// ─── I. Navigation System ────────────────────────────────────────────
export type NavigationRoute =
  | "auth"
  | "workspace"
  | "academic"
  | "communication"
  | "schedule"
  | "finance"
  | "ai_agent"
  | "settings"
  | "notifications"
  | "admin"
  | "digital_twin"
  | "marketplace"
  | "developer"
  | "profile"
  | "support";

export interface DeepLinkHandler {
  readonly scheme: string;
  readonly pathPattern: string;
  readonly targetRoute: NavigationRoute;
  readonly requiresAuth: boolean;
}

// ─── J–K. Design System & Responsive System ─────────────────────────
export type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export type ColorScheme = "light" | "dark" | "system";

export interface ResponsiveConfig {
  readonly breakpoint: Breakpoint;
  readonly orientation: "portrait" | "landscape";
  readonly width: number;
  readonly height: number;
  readonly pixelDensity: number;
  readonly isTablet: boolean;
  readonly isDesktop: boolean;
}

export interface ThemeConfig {
  readonly colorScheme: ColorScheme;
  readonly primaryColor: string;
  readonly fontSize: number;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
}

// ─── L. Client State Management ─────────────────────────────────────
export interface ClientState {
  readonly auth: { authenticated: boolean; userId: string | null; tenantId: string | null };
  readonly workspace: { current: string | null; permissions: string[] };
  readonly ui: { theme: ThemeConfig; responsive: ResponsiveConfig | null };
  readonly cache: { lastSync: string | null; pendingChanges: number };
  readonly connectivity: { online: boolean; quality: "good" | "fair" | "poor" | "none" };
}
// ─── AD. Client API Layer ─────────────────────────────────────────────
export type ApiRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequest {
  readonly method: ApiRequestMethod;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown | null;
  readonly requiresAuth: boolean;
  readonly timeout: number;
  readonly retryCount: number;
  readonly idempotencyKey: string | null;
}

export interface ApiResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly data: unknown;
  readonly duration: number;
  readonly fromCache: boolean;
}

// ─── AE–AG. Error, Resilience, Performance ──────────────────────────
export type ClientErrorCategory =
  | "network"
  | "auth"
  | "validation"
  | "server"
  | "client_crash"
  | "timeout"
  | "storage"
  | "permission"
  | "unknown";

export interface ClientError {
  readonly id: string;
  readonly category: ClientErrorCategory;
  readonly message: string;
  readonly stackTrace: string | null;
  readonly timestamp: string;
  readonly context: Record<string, unknown>;
}

export interface ClientResilienceConfig {
  readonly maxRetries: number;
  readonly exponentialBackoff: boolean;
  readonly circuitBreakerThreshold: number;
  readonly cacheFallback: boolean;
  readonly timeout: number;
  readonly staleDataTolerance: number;
}

export interface ClientPerformanceMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: "ms" | "bytes" | "count" | "percentage";
  readonly timestamp: string;
  readonly tags: Record<string, string>;
}

// ─── AL–AT. Workspace Integration ────────────────────────────────────
export interface WorkspaceIntegration {
  readonly route: NavigationRoute;
  readonly moduleId: string;
  readonly requiredPermissions: string[];
  readonly offlineCapable: boolean;
  readonly syncRequired: boolean;
}

// ─── BL–BO. Desktop, Tablet, PWA ─────────────────────────────────────
export interface DesktopFeatures {
  readonly multiWindow: boolean;
  readonly menuBar: boolean;
  readonly keyboardShortcuts: string[];
  readonly systemTray: boolean;
  readonly autoStart: boolean;
}

export interface PWAConfig {
  readonly manifestPath: string;
  readonly serviceWorkerPath: string;
  readonly offlinePage: string;
  readonly installable: boolean;
  readonly pushEnabled: boolean;
  readonly backgroundSync: boolean;
}

// ─── BW–BX. Account Switching & Multi-Tenant Isolation ──────────────
export interface AccountSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly lastActiveAt: string;
}

export interface MultiAccountConfig {
  readonly maxSessions: number;
  readonly sessionStorage: "secure" | "memory" | "persistent";
  readonly autoSwitch: boolean;
  readonly isolatedStorage: boolean;
}

// ─── BY. Crash Recovery ──────────────────────────────────────────────
export interface CrashReport {
  readonly id: string;
  readonly error: string;
  readonly stackTrace: string;
  readonly deviceInfo: Record<string, string>;
  readonly appState: string;
  readonly timestamp: string;
  readonly userConsented: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createLaunchContext(params: {
  source: AppLaunchSource;
  deepLink?: string;
  notificationPayload?: Record<string, unknown>;
  previousState?: AppLifecycleState | null;
}): AppLaunchContext {
  return {
    source: params.source,
    deepLink: params.deepLink ?? null,
    notificationPayload: params.notificationPayload ?? null,
    previousState: params.previousState ?? null,
    timestamp: timeAuthority.now().at,
  };
}

export function getBreakpoint(width: number): Breakpoint {
  if (width < 576) return "xs";
  if (width < 768) return "sm";
  if (width < 992) return "md";
  if (width < 1200) return "lg";
  if (width < 1400) return "xl";
  return "xxl";
}

export function classifyConnectivity(
  online: boolean,
  latency: number,
): ClientState["connectivity"]["quality"] {
  if (!online) return "none";
  if (latency < 100) return "good";
  if (latency < 500) return "fair";
  return "poor";
}

export function createApiRequest(params: {
  method: ApiRequestMethod;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  requiresAuth?: boolean;
  timeout?: number;
  retryCount?: number;
  idempotencyKey?: string;
}): ApiRequest {
  if (!params.path) throw new Error("API request requires a path");
  return {
    method: params.method,
    path: params.path,
    headers: params.headers ?? { "content-type": "application/json" },
    body: params.body ?? null,
    requiresAuth: params.requiresAuth ?? true,
    timeout: params.timeout ?? 30000,
    retryCount: params.retryCount ?? 0,
    idempotencyKey: params.idempotencyKey ?? null,
  };
}

export function createDeepLinkHandler(params: {
  scheme: string;
  pathPattern: string;
  targetRoute: NavigationRoute;
  requiresAuth?: boolean;
}): DeepLinkHandler {
  if (!params.scheme || !params.pathPattern) throw new Error("Deep link requires scheme and path");
  return {
    scheme: params.scheme,
    pathPattern: params.pathPattern,
    targetRoute: params.targetRoute,
    requiresAuth: params.requiresAuth ?? true,
  };
}

export function validateNavigationRoute(route: string): NavigationRoute | null {
  const valid: NavigationRoute[] = [
    "auth",
    "workspace",
    "academic",
    "communication",
    "schedule",
    "finance",
    "ai_agent",
    "settings",
    "notifications",
    "admin",
    "digital_twin",
    "marketplace",
    "developer",
    "profile",
    "support",
  ];
  return valid.includes(route as NavigationRoute) ? (route as NavigationRoute) : null;
}
