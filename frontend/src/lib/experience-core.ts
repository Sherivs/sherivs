// ─── CoreGrid Phase 24 — Experience & Design Intelligence ────────────
// experience-core.ts — Design language, tokens, component architecture,
//                      navigation, search, command palette, layout
// ──────────────────────────────────────────────────────────────────────
// Sections: E, F, G, H, I, J, K, L, M, N, X, Y, Z, AA, AT, AU, AV,
//           AW, AX, AY, AZ, BA, BB, BC, BD, BE, BF, BG, BH, BI, BJ, BK

export type DesignTokenCategory =
  "color" | "typography" | "spacing" | "size" | "shadow" | "radius" | "animation" | "z-index";

export interface DesignToken {
  readonly name: string;
  readonly category: DesignTokenCategory;
  readonly value: string | number;
  readonly description: string;
  readonly deprecated: boolean;
  readonly replacement: string | null;
}

export interface SemanticColorSystem {
  readonly primary: { default: string; hover: string; active: string; disabled: string };
  readonly secondary: { default: string; hover: string; active: string; disabled: string };
  readonly surface: { default: string; elevated: string; modal: string; overlay: string };
  readonly text: { primary: string; secondary: string; disabled: string; inverse: string };
  readonly border: { default: string; focus: string; error: string; success: string };
  readonly status: { success: string; warning: string; error: string; info: string };
  readonly semantic: Record<string, string>;
}

export interface TypographySystem {
  readonly fontFamily: { heading: string; body: string; mono: string };
  readonly fontScale: Record<
    string,
    { size: number; lineHeight: number; weight: number; letterSpacing: number }
  >;
  readonly weight: { regular: number; medium: number; semibold: number; bold: number };
}

export interface SpacingSystem {
  readonly unit: number;
  readonly scale: Record<string, number>;
  readonly compact: Record<string, number>;
  readonly comfortable: Record<string, number>;
}

export interface ComponentStateModel {
  readonly states: (
    | "default"
    | "hover"
    | "focus"
    | "active"
    | "disabled"
    | "loading"
    | "error"
    | "empty"
    | "readonly"
    | "selected"
  )[];
  readonly transitions: { from: string; to: string; duration: number; easing: string }[];
}

export interface ComponentContract {
  readonly name: string;
  readonly props: Record<string, string>;
  readonly states: string[];
  readonly slots: string[];
  readonly accessibility: { role: string; ariaAttributes: string[] };
  readonly responsiveBehavior: "stack" | "hide" | "compress" | "transform";
}

export interface NavigationSystem {
  readonly primaryItems: { label: string; route: string; icon: string; permissions: string[] }[];
  readonly secondaryItems: { label: string; route: string; icon: string }[];
  readonly breadcrumbEnabled: boolean;
  readonly contextualBack: boolean;
  readonly sidebarCollapsible: boolean;
}

export interface GlobalCommandPalette {
  readonly enabled: boolean;
  readonly trigger: string;
  readonly commands: {
    id: string;
    label: string;
    category: string;
    keywords: string[];
    action: string;
  }[];
  readonly recentCommands: number;
  readonly searchResults: boolean;
}

export interface SearchExperience {
  readonly globalSearch: boolean;
  readonly contextualSearch: boolean;
  readonly searchableEntities: string[];
  readonly filters: string[];
  readonly recentSearches: boolean;
  readonly savedSearches: boolean;
}

export interface DataDenseUX {
  readonly densityMode: "compact" | "normal" | "comfortable";
  readonly virtualization: boolean;
  readonly stickyHeaders: boolean;
  readonly inlineEditing: boolean;
  readonly bulkActions: boolean;
  readonly exportEnabled: boolean;
}

export interface FormExperience {
  readonly validationStyle: "inline" | "tooltip" | "summary";
  readonly autosave: boolean;
  readonly draftPreservation: boolean;
  readonly undoSupport: boolean;
  readonly smartDefaults: boolean;
  readonly progressiveDisclosure: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createDesignToken(params: {
  name: string;
  category: DesignTokenCategory;
  value: string | number;
  description: string;
}): DesignToken {
  return {
    name: params.name,
    category: params.category,
    value: params.value,
    description: params.description,
    deprecated: false,
    replacement: null,
  };
}

export function deprecateToken(token: DesignToken, replacement: string): DesignToken {
  return { ...token, deprecated: true, replacement };
}

export function getSpacingValue(
  space: SpacingSystem,
  key: string,
  density?: "compact" | "comfortable",
): number {
  const scale =
    density === "compact"
      ? space.compact
      : density === "comfortable"
        ? space.comfortable
        : space.scale;
  return scale[key] ?? space.scale[key] ?? space.unit;
}

export function createCommandPalette(params: {
  commands: { id: string; label: string; category: string; keywords: string[]; action: string }[];
  trigger?: string;
}): GlobalCommandPalette {
  return {
    enabled: true,
    trigger: params.trigger ?? "cmd+k",
    commands: params.commands,
    recentCommands: 5,
    searchResults: true,
  };
}

export function filterCommands(
  palette: GlobalCommandPalette,
  query: string,
): { id: string; label: string; category: string }[] {
  const q = query.toLowerCase();
  return palette.commands
    .filter(
      (c) =>
        c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q)),
    )
    .map((c) => ({ id: c.id, label: c.label, category: c.category }));
}
