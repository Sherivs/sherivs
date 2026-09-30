// ─── CoreGrid Phase 23 — Web Platform ───────────────────────────────
// web-core.ts — Web runtime, routing, URL architecture, rendering,
//               browser security, CSP, XSS, CSRF, cookies, auth
// ──────────────────────────────────────────────────────────────────────
// Sections: F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W,
//           BJ, BK, BL, BM, BN

export type WebBrowser = "chrome" | "firefox" | "safari" | "edge" | "opera" | "samsung" | "unknown";
export type WebEngine = "blink" | "webkit" | "gecko" | "unknown";
export type RenderingMode = "csr" | "ssr" | "ssg" | "isr" | "streaming_ssr";

// ─── F–H. Web Architecture, Runtime & Rendering ──────────────────────
export interface WebRuntimeConfig {
  readonly renderingMode: RenderingMode;
  readonly hydration: boolean;
  readonly streaming: boolean;
  readonly concurrentFeatures: boolean;
  readonly suspenseBoundaries: boolean;
  readonly errorBoundaries: boolean;
}

export interface BrowserInfo {
  readonly browser: WebBrowser;
  readonly engine: WebEngine;
  readonly version: string;
  readonly supported: boolean;
  readonly capabilities: string[];
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly prefersReducedMotion: boolean;
  readonly prefersColorScheme: "light" | "dark" | "no_preference";
}

// ─── I–J. Application Routing & URL Architecture ─────────────────────
export type RouteSecurity = "public" | "authenticated" | "authorized" | "admin" | "internal";

export interface WebRouteDefinition {
  readonly path: string;
  readonly component: string;
  readonly security: RouteSecurity;
  readonly requiredPermissions: string[];
  readonly metadata: Record<string, string>;
  readonly lazyLoaded: boolean;
  readonly preload: boolean;
}

export interface URLArchitecture {
  readonly baseUrl: string;
  readonly protocol: string;
  readonly domain: string;
  readonly pathPrefix: string;
  readonly trailingSlash: boolean;
  readonly caseSensitive: boolean;
}

// ─── L–Q. Browser Security Model ─────────────────────────────────────
export interface ContentSecurityPolicy {
  readonly defaultSrc: string[];
  readonly scriptSrc: string[];
  readonly styleSrc: string[];
  readonly imgSrc: string[];
  readonly connectSrc: string[];
  readonly fontSrc: string[];
  readonly frameSrc: string[];
  readonly objectSrc: string[];
  readonly reportUri: string | null;
  readonly strictDynamic: boolean;
}

export interface SecurityHeaders {
  readonly xFrameOptions: "DENY" | "SAMEORIGIN" | "ALLOW-FROM";
  readonly xContentTypeOptions: "nosniff";
  readonly strictTransportSecurity: string;
  readonly referrerPolicy: "strict-origin-when-cross-origin" | "same-origin" | "no-referrer";
  readonly permissionsPolicy: string[];
  readonly crossOriginOpenerPolicy: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  readonly crossOriginEmbedderPolicy: "require-corp" | "credentialless" | "unsafe-none";
  readonly crossOriginResourcePolicy: "same-origin" | "same-site" | "cross-origin";
}

export interface XSSProtection {
  readonly sanitizeUserInput: boolean;
  readonly escapeHTML: boolean;
  readonly validateURLs: boolean;
  readonly contentSecurityPolicyEnabled: boolean;
  readonly trustedTypesEnabled: boolean;
}

export interface CSRFProtection {
  readonly tokenRequired: boolean;
  readonly sameSiteCookie: "strict" | "lax" | "none";
  readonly doubleSubmitCookie: boolean;
  readonly customHeaderRequired: boolean;
  readonly originValidation: boolean;
}

// ─── R–T. Cookie Architecture & Web Authentication ───────────────────
export interface SecureCookieConfig {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "strict" | "lax" | "none";
  readonly domain: string;
  readonly path: string;
  readonly maxAge: number;
  readonly partitioned: boolean;
}

export interface WebAuthConfig {
  readonly sessionCookieName: string;
  readonly refreshTokenCookieName: string;
  readonly tokenEndpoint: string;
  readonly logoutEndpoint: string;
  readonly mfaRequired: boolean;
  readonly passkeysEnabled: boolean;
  readonly oidcProvider: string | null;
}

// ─── U. Passkeys / WebAuthn ──────────────────────────────────────────
export interface WebAuthnConfig {
  readonly enabled: boolean;
  readonly rpId: string;
  readonly rpName: string;
  readonly userVerification: "required" | "preferred" | "discouraged";
  readonly authenticatorAttachment: "platform" | "cross-platform" | "any";
}

// ─── V–W. Multi-Tenant Web Context & Multi-Tab ──────────────────────
export interface MultiTabCoordinator {
  readonly broadcastChannel: string;
  readonly sharedWorker: boolean;
  readonly tabLockTimeout: number;
  readonly conflictStrategy: "last_active_wins" | "prompt_user" | "first_active_wins";
}

// ─── BJ. URL Validation ─────────────────────────────────────────────
export interface URLValidationResult {
  readonly valid: boolean;
  readonly sanitized: string | null;
  readonly reason: string | null;
}

// ─ Functions ────────────────────────────────────────────────────────────
export function createWebRouteDefinition(params: {
  path: string;
  component: string;
  security: RouteSecurity;
  requiredPermissions?: string[];
  lazyLoaded?: boolean;
  preload?: boolean;
  metadata?: Record<string, string>;
}): WebRouteDefinition {
  if (!params.path || !params.component) throw new Error("Route requires path and component");
  return {
    path: params.path,
    component: params.component,
    security: params.security,
    requiredPermissions: params.requiredPermissions ?? [],
    metadata: params.metadata ?? {},
    lazyLoaded: params.lazyLoaded ?? true,
    preload: params.preload ?? false,
  };
}
export function createContentSecurityPolicy(
  params: Partial<ContentSecurityPolicy>,
): ContentSecurityPolicy {
  return {
    defaultSrc: params.defaultSrc ?? ["'self'"],
    scriptSrc: params.scriptSrc ?? ["'self'"],
    styleSrc: params.styleSrc ?? ["'self'"],
    imgSrc: params.imgSrc ?? ["'self'"],
    connectSrc: params.connectSrc ?? ["'self'"],
    fontSrc: params.fontSrc ?? ["'self'"],
    frameSrc: params.frameSrc ?? ["'self'"],
    objectSrc: params.objectSrc ?? ["'none'"],
    reportUri: params.reportUri ?? null,
    strictDynamic: params.strictDynamic ?? false,
  };
}

export function validateURL(url: string): URLValidationResult {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, sanitized: null, reason: "Unsupported protocol" };
    }
    if (parsed.protocol === "http:" && !url.startsWith("http://localhost")) {
      return { valid: false, sanitized: null, reason: "HTTPS required" };
    }
    return { valid: true, sanitized: parsed.toString(), reason: null };
  } catch {
    return { valid: false, sanitized: null, reason: "Invalid URL format" };
  }
}

export function classifyBrowser(ua: string): BrowserInfo {
  const isChrome = ua.includes("Chrome") && !ua.includes("Edg");
  const isFirefox = ua.includes("Firefox");
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome");
  const isEdge = ua.includes("Edg");
  const browser: WebBrowser = isEdge
    ? "edge"
    : isFirefox
      ? "firefox"
      : isSafari
        ? "safari"
        : isChrome
          ? "chrome"
          : "unknown";
  const engine: WebEngine = isFirefox ? "gecko" : isSafari ? "webkit" : "blink";
  const supported = browser !== "unknown";
  return {
    browser,
    engine,
    version: "0",
    supported,
    capabilities: [],
    screenWidth: 0,
    screenHeight: 0,
    prefersReducedMotion: false,
    prefersColorScheme: "no_preference",
  };
}

export function sanitizeHTML(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
