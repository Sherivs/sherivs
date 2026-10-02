import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 24 — Experience & Design Intelligence ────────────
// experience-personalization.ts — Personalization, AI experience,
//                                 workspace, device adaptation, AI UX
// ──────────────────────────────────────────────────────────────────────
// Sections: P, Q, R, S, T, U, V, W, AB, AC, AD, AE, AF, AG, AH, AI,
//           AJ, AK, AL, AM, AN, AO, AP, AQ, AR, AS, BV, BW, BY, BZ,
//           CA, CB, CC, CD, CE, CF, CG, CH, CI, CJ, CK, DE, DF, DG

export type UserExperienceLevel = "novice" | "intermediate" | "advanced" | "expert";

export interface PersonalizationProfile {
  readonly userId: string;
  readonly experienceLevel: UserExperienceLevel;
  readonly densityPreference: "compact" | "normal" | "comfortable";
  readonly themePreference: "light" | "dark" | "system";
  readonly language: string;
  readonly shortcuts: Record<string, string>;
  readonly hiddenSections: string[];
  readonly pinnedItems: string[];
}

export interface RoleAwareExperience {
  readonly role: string;
  readonly defaultHome: string;
  readonly availableModules: string[];
  readonly quickActions: { label: string; action: string }[];
  readonly contextualTips: string[];
  readonly restrictedFeatures: string[];
}

export interface DeviceAwareExperience {
  readonly deviceType: "phone" | "tablet" | "laptop" | "desktop";
  readonly inputMethod: "touch" | "mouse" | "keyboard" | "pen" | "voice" | "spatial";
  readonly layout: "single_pane" | "split_pane" | "multi_pane";
  readonly navigationStyle: "tab" | "sidebar" | "drawer" | "top_bar";
  readonly density: "compact" | "normal" | "comfortable";
}

export interface AIAssistantExperience {
  readonly enabled: boolean;
  readonly position: "floating" | "sidebar" | "drawer" | "inline" | "fullscreen";
  readonly suggestedPrompts: string[];
  readonly contextAware: boolean;
  readonly showCitations: boolean;
  readonly showArtifacts: boolean;
  readonly streamingEnabled: boolean;
  readonly approvalRequired: boolean;
}

export interface AIMessageModel {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: string;
  readonly citations: { source: string; relevance: number }[];
  readonly artifacts: { id: string; type: string; data: unknown }[];
  readonly streaming: boolean;
  readonly error: string | null;
}

export interface AIApprovalExperience {
  readonly showRiskIndicator: boolean;
  readonly requireConfirmation: boolean;
  readonly confirmationMethod: "tap" | "biometric" | "password" | "mfa";
  readonly showConsequences: boolean;
  readonly undoEnabled: boolean;
  readonly timeout: number;
}

export interface WorkspaceExperience {
  readonly layout: "grid" | "list" | "board" | "timeline";
  readonly widgets: { id: string; type: string; position: number; visible: boolean }[];
  readonly customSections: { id: string; title: string; pinned: boolean }[];
  readonly showOnboarding: boolean;
}

export interface DashboardExperience {
  readonly defaultView: "overview" | "detail" | "comparison";
  readonly editable: boolean;
  readonly maxWidgets: number;
  readonly refreshInterval: number;
  readonly exportable: boolean;
}

export interface NotificationExperience {
  readonly grouping: "by_app" | "by_type" | "by_time" | "none";
  readonly priorityLevels: boolean;
  readonly actionButtons: boolean;
  readonly inlineReplies: boolean;
  readonly dismissGestures: boolean;
  readonly badgeCount: boolean;
}

export interface DensityMode {
  readonly current: "compact" | "normal" | "comfortable";
  readonly autoAdjust: boolean;
  readonly persistPreference: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createPersonalizationProfile(params: {
  userId: string;
  experienceLevel?: UserExperienceLevel;
}): PersonalizationProfile {
  return {
    userId: params.userId,
    experienceLevel: params.experienceLevel ?? "intermediate",
    densityPreference: "normal",
    themePreference: "system",
    language: "en",
    shortcuts: {},
    hiddenSections: [],
    pinnedItems: [],
  };
}

export function getDeviceAwareExperience(
  deviceType: DeviceAwareExperience["deviceType"],
): DeviceAwareExperience {
  const configs: Record<string, DeviceAwareExperience> = {
    phone: {
      deviceType: "phone",
      inputMethod: "touch",
      layout: "single_pane",
      navigationStyle: "tab",
      density: "normal",
    },
    tablet: {
      deviceType: "tablet",
      inputMethod: "touch",
      layout: "split_pane",
      navigationStyle: "sidebar",
      density: "normal",
    },
    laptop: {
      deviceType: "laptop",
      inputMethod: "keyboard",
      layout: "multi_pane",
      navigationStyle: "sidebar",
      density: "normal",
    },
    desktop: {
      deviceType: "desktop",
      inputMethod: "mouse",
      layout: "multi_pane",
      navigationStyle: "sidebar",
      density: "normal",
    },
  };
  return configs[deviceType] ?? configs.laptop;
}

export function createAIMessage(params: {
  role: AIMessageModel["role"];
  content: string;
  streaming?: boolean;
}): AIMessageModel {
  return {
    id: `ai-msg-${timeAuthority.now().atMs}`,
    role: params.role,
    content: params.content,
    timestamp: timeAuthority.now().at,
    citations: [],
    artifacts: [],
    streaming: params.streaming ?? false,
    error: null,
  };
}

export function filterCommandsByRole(
  commands: { id: string; label: string; category: string; permissions?: string[] }[],
  role: string,
): { id: string; label: string; category: string }[] {
  return commands
    .filter((c) => !c.permissions || c.permissions.length === 0 || c.permissions.includes(role))
    .map((c) => ({ id: c.id, label: c.label, category: c.category }));
}

export function createNotificationExperience(
  partial?: Partial<NotificationExperience>,
): NotificationExperience {
  return {
    grouping: "by_type",
    priorityLevels: true,
    actionButtons: true,
    inlineReplies: false,
    dismissGestures: true,
    badgeCount: true,
    ...partial,
  };
}
