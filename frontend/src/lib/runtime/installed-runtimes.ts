/**
 * CoreGrid — installed runtimes (runtime layer).
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
  description: string;
}

/** Installed runtimes, in installation order. */
export const INSTALLED_RUNTIMES: readonly InstalledRuntime[] = [
  { id: "runtime:scholar", name: "Scholar", description: "African Education Runtime" },
];

export const FIRST_INSTALLED_RUNTIME = INSTALLED_RUNTIMES[0];
export const INSTALLED_RUNTIME_ID = FIRST_INSTALLED_RUNTIME.id;
export const INSTALLED_RUNTIME_NAME = FIRST_INSTALLED_RUNTIME.name;
export const INSTALLED_RUNTIME_DESCRIPTION = FIRST_INSTALLED_RUNTIME.description;

/** Customer-facing product lockup: platform + installed runtime name. */
export const INSTALLED_RUNTIME_PRODUCT = `Sherivs ${INSTALLED_RUNTIME_NAME}`;
