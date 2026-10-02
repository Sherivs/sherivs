import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 22 — Mobile Platform ─────────────────────────────
// platform-observability.ts — Client observability, AI interaction,
//                             analytics telemetry, feature flags, OTA
// ──────────────────────────────────────────────────────────────────────

// ─── AH. Client Observability ────────────────────────────────────────
export interface ClientTelemetryEvent {
  readonly id: string;
  readonly eventType: string;
  readonly category:
    "user_action" | "screen_view" | "api_call" | "error" | "performance" | "lifecycle";
  readonly timestamp: string;
  readonly duration: number | null;
  readonly properties: Record<string, string | number | boolean | null>;
  readonly anonymized: boolean;
}

export interface ClientTelemetryConfig {
  readonly enabled: boolean;
  readonly anonymizeData: boolean;
  readonly samplingRate: number;
  readonly maxQueueSize: number;
  readonly flushIntervalMs: number;
  readonly includeScreenViews: boolean;
  readonly includePerformanceMetrics: boolean;
  readonly includeErrorReports: boolean;
  readonly optOutAllowed: boolean;
}

// ─── AJ–AK. AI Interaction & Action UX ───────────────────────────────
export interface ClientAIInteraction {
  readonly id: string;
  readonly agentId: string;
  readonly prompt: string;
  readonly response: string;
  readonly durationMs: number;
  readonly streaming: boolean;
  readonly timestamp: string;
  readonly error: string | null;
}

export interface ClientAIStreamState {
  readonly active: boolean;
  readonly receivedTokens: number;
  readonly estimatedTotalTokens: number;
  readonly elapsedMs: number;
  readonly connected: boolean;
  readonly error: string | null;
}

export interface ClientAIActionConfirmation {
  readonly actionId: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
  readonly riskLevel: "low" | "medium" | "high";
  readonly confirmBy: "tap" | "biometric" | "password";
  readonly timeout: number;
}

// ─── BC. Feature Flags ───────────────────────────────────────────────
export interface FeatureFlag {
  readonly name: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly targetAudience: string | null;
  readonly dependencies: string[];
  readonly expiresAt: string | null;
}

// ─── BB. Version Compatibility ───────────────────────────────────────
export interface VersionCompatibility {
  readonly appVersion: string;
  readonly minApiVersion: string;
  readonly minDataVersion: string;
  readonly requiredUpgrade: boolean;
  readonly deprecationMessage: string | null;
  readonly compatible: boolean;
}

// ─── BA–AZ. OTA Updates & Release Channels ──────────────────────────
export type ReleaseChannel = "stable" | "beta" | "alpha" | "canary" | "internal";

export interface OTAUpdate {
  readonly id: string;
  readonly version: string;
  readonly channel: ReleaseChannel;
  readonly releaseNotes: string;
  readonly downloadUrl: string;
  readonly sizeBytes: number;
  readonly required: boolean;
  readonly rollbackSupported: boolean;
  readonly publishedAt: string;
}

export interface OTAUpdateState {
  readonly available: boolean;
  readonly downloading: boolean;
  readonly downloaded: boolean;
  readonly progress: number;
  readonly error: string | null;
  readonly pendingRestart: boolean;
}

// ─── BI–BJ. Analytics & Client Audit ────────────────────────────────
export interface ClientAnalyticsEvent {
  readonly id: string;
  readonly eventName: string;
  readonly category: string;
  readonly label: string | null;
  readonly value: number | null;
  readonly timestamp: string;
  readonly userId: string | null;
  readonly anonymized: boolean;
}

export interface ClientAuditEvent {
  readonly id: string;
  readonly eventType: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: string;
  readonly offlineGenerated: boolean;
}

// ─── BZ. User Feedback ────────────────────────────────────────────────
export interface UserFeedback {
  readonly id: string;
  readonly userId: string | null;
  readonly type: "bug_report" | "feature_request" | "rating" | "comment";
  readonly message: string;
  readonly rating: number | null;
  readonly appVersion: string;
  readonly deviceInfo: string;
  readonly timestamp: string;
  readonly attachments: string[];
  readonly userConsented: boolean;
}
// ─── Functions ────────────────────────────────────────────────────────
export function createTelemetryEvent(params: {
  eventType: string;
  category: ClientTelemetryEvent["category"];
  duration?: number;
  properties?: Record<string, string | number | boolean | null>;
  anonymized?: boolean;
}): ClientTelemetryEvent {
  return {
    id: `telem-${timeAuthority.now().atMs}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: params.eventType,
    category: params.category,
    timestamp: timeAuthority.now().at,
    duration: params.duration ?? null,
    properties: params.properties ?? {},
    anonymized: params.anonymized ?? true,
  };
}

export function checkVersionCompatibility(
  appVersion: string,
  minApiVersion: string,
  minDataVersion: string,
): VersionCompatibility {
  const appParts = appVersion.split(".").map(Number);
  const apiParts = minApiVersion.split(".").map(Number);
  const dataParts = minDataVersion.split(".").map(Number);
  const compatible =
    appParts[0] >= apiParts[0] && (appParts[0] > apiParts[0] || appParts[1] >= apiParts[1]);
  return {
    appVersion,
    minApiVersion,
    minDataVersion,
    requiredUpgrade: !compatible,
    deprecationMessage: compatible ? null : "App version is no longer supported",
    compatible,
  };
}

export function createAIInteraction(params: {
  agentId: string;
  prompt: string;
  response: string;
  durationMs: number;
  streaming?: boolean;
  error?: string | null;
}): ClientAIInteraction {
  return {
    id: `ai-${timeAuthority.now().atMs}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: params.agentId,
    prompt: params.prompt,
    response: params.response,
    durationMs: params.durationMs,
    streaming: params.streaming ?? false,
    timestamp: timeAuthority.now().at,
    error: params.error ?? null,
  };
}

export function createClientAuditEvent(params: {
  eventType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
}): ClientAuditEvent {
  return {
    id: `audit-${timeAuthority.now().atMs}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: params.eventType,
    actorId: params.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    details: params.details ?? {},
    timestamp: timeAuthority.now().at,
    offlineGenerated: false,
  };
}

export function evaluateOTAUpdateState(
  available: boolean,
  downloading: boolean,
  progress: number,
): OTAUpdateState {
  return {
    available,
    downloading,
    downloaded: available && !downloading && progress === 100,
    progress,
    error: null,
    pendingRestart: false,
  };
}

export function isMinorUpdate(update: OTAUpdate): boolean {
  const currentVersion = update.version.split(".").map(Number);
  const targetVersion = update.version.split(".").map(Number);
  return currentVersion[0] === targetVersion[0] && currentVersion[1] === targetVersion[1];
}
