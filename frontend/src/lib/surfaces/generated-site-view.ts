/**
 * CoreGrid — generated-site surface view-model (WAVE-R40).
 *
 * The UI layer's contract with the experience engine. A route renders this
 * object; it never re-derives sections, brand, navigation or governance itself,
 * and it never contains a per-organization branch.
 *
 * One source, three surfaces: the same view feeds the public site renderer
 * (/reality/:class), the served manifest (/manifest.webmanifest) and the install
 * preview — so navigation anchors and manifest shortcuts can never disagree.
 *
 * Boundary: this module is UI-layer derivation. It performs no authorization,
 * writes nothing, and treats governance as INPUT (it renders the issues the
 * engine returns rather than editing them away).
 */

import type { BrandIdentity } from "@/lib/scholar/experience/experience-brand";
import { defaultBrand } from "@/lib/scholar/experience/experience-brand";
import {
  AUDIENCE_ROLE_CATEGORIES,
  audiencesForRoles,
} from "@/lib/scholar/experience/experience-personalization";
import { roleCategoryLabel } from "@/lib/scholar/roles/role-categories";
import {
  generateExperience,
  type GeneratedExperience,
} from "@/lib/scholar/experience/experience-engine";
import type {
  ExperienceAudience,
  SiteComponent,
  SiteSection,
} from "@/lib/scholar/experience/experience-catalog";
import {
  governExperience,
  type ExperienceGovernanceResult,
} from "@/lib/scholar/experience/experience-governance";
import { realityForOrgType } from "@/lib/scholar/experience/experience-presets";
import {
  buildWebAppManifest,
  validateWebAppManifest,
  type WebAppManifest,
} from "@/lib/scholar/pwa/manifest-engine";
import {
  nativeShellAdapter,
  validateShellAdapter,
  SHELL_TARGETS,
  type NativeShellAdapter,
  type ShellTarget,
} from "@/lib/scholar/pwa/shell-adapters";

export interface GeneratedSiteNavItem {
  section: SiteSection;
  label: string;
  /** In-page anchor; identical to the manifest shortcut target. */
  anchor: string;
}

export interface GeneratedSiteBlock {
  section: SiteSection;
  anchor: string;
  label: string;
  components: readonly SiteComponent[];
  /** Provenance: why this section exists in this organization's reality. */
  rationale: readonly string[];
  audiences: readonly ExperienceAudience[];
  /** True when the section needs an approved content item before publication. */
  awaitingApproval: boolean;
}

export interface GeneratedSiteShell {
  target: ShellTarget;
  adapter: NativeShellAdapter;
  issues: readonly string[];
}

export interface GeneratedSiteView {
  orgType: string;
  /** Display label derived from the organization class key (never hardcoded). */
  label: string;
  experience: GeneratedExperience;
  brand: BrandIdentity;
  navigation: readonly GeneratedSiteNavItem[];
  blocks: readonly GeneratedSiteBlock[];
  /** Governance as decided by the engine — the surface renders, never edits. */
  governance: ExperienceGovernanceResult;
  manifest: WebAppManifest;
  manifestIssues: readonly string[];
  shells: readonly GeneratedSiteShell[];
  /** Installability of the served manifest (validation returned no issue). */
  installable: boolean;
}

export interface GeneratedSiteViewInput {
  orgType: string;
  /** Tenant context when this environment is bound to a real organization. */
  tenantId?: string | null;
  brand?: Partial<BrandIdentity>;
  /** Audience the surface is generated for (default: public visitor). */
  audience?: ExperienceAudience;
}

/** `multi_campus_network` → `Multi Campus Network`. */
export function organizationClassLabel(orgType: string): string {
  const words = orgType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);
  return words.length > 0 ? words.join(" ") : orgType;
}

export function buildGeneratedSiteView(input: GeneratedSiteViewInput): GeneratedSiteView {
  const audience: ExperienceAudience = input.audience ?? "public_visitor";
  const label = organizationClassLabel(input.orgType);
  const reality = realityForOrgType(input.orgType);
  const experience = generateExperience({
    reality,
    brand: { name: label, ...input.brand },
  });

  const navigation: GeneratedSiteNavItem[] = experience.sections
    .filter((section) => section.audiences.includes(audience))
    .map((section) => ({
      section: section.section,
      label: section.label,
      anchor: `#${section.section}`,
    }));

  const served = new Set(navigation.map((item) => item.section));
  const blocks: GeneratedSiteBlock[] = experience.sections
    .filter((section) => served.has(section.section))
    .map((section) => ({
      section: section.section,
      anchor: `#${section.section}`,
      label: section.label,
      components: section.components,
      rationale: section.rationale,
      audiences: section.audiences,
      awaitingApproval: section.requiresApproval,
    }));

  const governance = governExperience({
    tenantId: input.tenantId ?? null,
    audience,
    experience,
  });

  const manifest = buildWebAppManifest({ brand: experience.brand, experience });
  const manifestIssues = validateWebAppManifest(manifest);

  const shells: GeneratedSiteShell[] = SHELL_TARGETS.map((target) => {
    const adapter = nativeShellAdapter(target);
    return { target, adapter, issues: validateShellAdapter(adapter) };
  });

  return {
    orgType: input.orgType,
    label,
    experience,
    brand: experience.brand,
    navigation,
    blocks,
    governance,
    manifest,
    manifestIssues,
    shells,
    installable: manifestIssues.length === 0,
  };
}

/** Audiences an organization class serves, with the role categories behind them. */
export function classAudienceIndex(orgType: string): readonly {
  audience: ExperienceAudience;
  roleCategories: readonly string[];
}[] {
  const experience = generateExperience({
    reality: realityForOrgType(orgType),
    includeInternalApplication: true,
  });
  const roleIds = experience.internalApplication.workspaces.flatMap(
    (workspace) => workspace.sourceRoles,
  );
  return audiencesForRoles(roleIds).map((audience) => ({
    audience,
    roleCategories: AUDIENCE_ROLE_CATEGORIES[audience].map(roleCategoryLabel),
  }));
}

/** A tenant-less environment is legitimate only as a labelled preview. */
export function isPreviewOnly(view: GeneratedSiteView): boolean {
  return view.governance.issues.some((issue) => issue.includes("no tenant context"));
}

export { defaultBrand };
