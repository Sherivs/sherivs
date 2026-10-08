/**
 * Sherivs — installed runtimes (runtime layer).
 *
 * Which runtime is installed on the platform, and what it calls itself, is runtime-layer
 * knowledge. The kernel and the platform's identity module own the platform, never one
 * runtime's name — so a runtime's identity lives here, and adding a runtime is a line in
 * this list plus its own contribution catalog and adapters.
 */
export interface InstalledRuntime {
  /** Manifest identifier, e.g. runtime:scholar. */
  id: string;
  name: string;
  /** Customer-facing product name of the runtime. */
  brandName: string;
  description: string;
  /** Public, customer-safe summary of what the runtime adds on top of the platform. */
  summary: string;
}

/** Installed runtimes, in installation order. */
export const INSTALLED_RUNTIMES: readonly InstalledRuntime[] = [
  {
    id: "runtime:scholar",
    name: "Scholar",
    brandName: "Sherivs Scholar",
    description: "African Education Runtime",
    summary:
      "The education runtime. An institution inherits the platform's governed core — identity, tenancy, security, workspaces, AI — and adds its education domain: admissions, classes, attendance, assessment, fees, transport and family communication.",
  },
];

export const FIRST_INSTALLED_RUNTIME = INSTALLED_RUNTIMES[0];
export const INSTALLED_RUNTIME_ID = FIRST_INSTALLED_RUNTIME.id;
export const INSTALLED_RUNTIME_NAME = FIRST_INSTALLED_RUNTIME.name;
export const INSTALLED_RUNTIME_BRAND_NAME = FIRST_INSTALLED_RUNTIME.brandName;
export const INSTALLED_RUNTIME_DESCRIPTION = FIRST_INSTALLED_RUNTIME.description;
