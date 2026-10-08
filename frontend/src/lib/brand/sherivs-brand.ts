/**
 * Sherivs customer brand, with the technical kernel name preserved.
 *
 * Customer-facing surfaces say Sherivs. Schemas, migrations, type names and
 * internal contracts keep CoreGrid so existing data and imports stay valid.
 * Classification is explicit: nothing here performs a blind rename.
 */

export type BrandReferenceClass =
  | "customer-facing"
  | "technical-identifier"
  | "preserve-compatibility";

export type BrandSurface =
  | "ui-copy"
  | "metadata"
  | "comment"
  | "type-name"
  | "module-path"
  | "migration"
  | "table"
  | "environment";

export interface BrandIdentity {
  readonly customerName: "Sherivs";
  readonly publicDomain: "sherivs.com";
  readonly publicOrigin: "https://sherivs.com";
  readonly category: "Institutional Intelligence Infrastructure";
  readonly educationRuntime: "Scholar";
  readonly executiveIntelligence: "Jarvis";
  readonly aiWorkforce: "Sherivs AI Workforce";
  /** Technical kernel identifier. Not a customer-facing brand. */
  readonly kernelName: "CoreGrid";
}

export const SHERIVS_BRAND: BrandIdentity = {
  customerName: "Sherivs",
  publicDomain: "sherivs.com",
  publicOrigin: "https://sherivs.com",
  category: "Institutional Intelligence Infrastructure",
  educationRuntime: "Scholar",
  executiveIntelligence: "Jarvis",
  aiWorkforce: "Sherivs AI Workforce",
  kernelName: "CoreGrid",
};

/**
 * Decide whether a reference may change.
 * UI copy and metadata become Sherivs.
 * Types, migrations, tables and env keys stay CoreGrid.
 */
export function classifyBrandReference(surface: BrandSurface): BrandReferenceClass {
  switch (surface) {
    case "ui-copy":
    case "metadata":
      return "customer-facing";
    case "type-name":
    case "module-path":
    case "migration":
    case "table":
    case "environment":
      return "preserve-compatibility";
    case "comment":
      return "technical-identifier";
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

export function customerBrandLabel(surface: BrandSurface): string {
  const classification = classifyBrandReference(surface);
  if (classification === "customer-facing") return SHERIVS_BRAND.customerName;
  return SHERIVS_BRAND.kernelName;
}
