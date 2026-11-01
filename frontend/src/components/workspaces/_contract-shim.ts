/**
 * TODO: Replace this compatibility contract with `@/lib/workspaces/contract`
 * when the M009-A1 contract is available in this branch.
 */
export interface WorkspaceManifestItem {
  key: string;
  kind: "nav" | "widget" | "action" | "inbox";
  icon: string;
  to: string;
  size: string;
  label: string;
  scope: string[];
  via: string[];
  scopeDims?: Record<string, string[]>;
}

export interface WorkspaceManifest {
  version: 1;
  org: { id: string; name: string; plan: string; features: string[] };
  families: string[];
  primaryFamily: string;
  locale: "en" | "ha" | "yo" | "ig" | "pcm";
  nav: WorkspaceManifestItem[];
  bottomNav: WorkspaceManifestItem[];
  widgets: WorkspaceManifestItem[];
  available: WorkspaceManifestItem[];
  actions: WorkspaceManifestItem[];
  inbox: WorkspaceManifestItem[];
  hiddenByPolicy: {
    key: string;
    reason: "permission" | "feature" | "family" | "policy" | "scope";
  }[];
  scopeOptions: Record<string, string[]>;
  policies: string[];
  canPersonalise: boolean;
}

export interface WorkspacePrefs {
  order?: string[];
  hidden?: string[];
  added?: string[];
  actions?: string[];
  locale?: WorkspaceManifest["locale"];
  density?: "comfortable" | "compact";
}
