/**
 * CoreGrid — Core Application Runtime feature flags.
 *
 * Implements `architecture/phase-05-core-application-runtime.md`:
 * - Feature flags (Section AN): gradual rollout, tenant-specific rollout,
 *   percentage rollout, emergency disablement, experimental features.
 * - Configuration management (Section AK): environment, tenant, feature, service.
 * - Kill switch (Section GX): critical capabilities may have controlled
 *   emergency disablement.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Feature flag model (Section AN)
 * ────────────────────────────────────────────────────────────*/

export type FeatureFlagStatus = "enabled" | "disabled" | "experimental" | "deprecated";

export interface FeatureFlag {
  /** Feature name, e.g. "ai-tutor". */
  name: string;
  /** Feature status. */
  status: FeatureFlagStatus;
  /** Whether this feature is enabled by default. */
  enabledByDefault: boolean;
  /** Tenant-specific overrides. */
  tenantOverrides: Record<string, boolean>;
  /** Percentage rollout (0-100). */
  rolloutPercentage: number;
  /** Whether this feature can be emergency-disabled (Section GX). */
  killSwitchEnabled: boolean;
  /** Whether this feature is currently kill-switched. */
  killSwitched: boolean;
  /** Feature description. */
  description: string;
}

export interface FeatureFlagContext {
  tenantId: TenantId | null;
  /** Deterministic identifier for percentage rollout. */
  rolloutKey: string;
}

export interface FeatureFlagService {
  register(flag: FeatureFlag): void;
  isEnabled(name: string, context: FeatureFlagContext): boolean;
  setTenantOverride(name: string, tenantId: string, enabled: boolean): boolean;
  emergencyDisable(name: string): boolean;
  emergencyEnable(name: string): boolean;
  list(): FeatureFlag[];
}

export function createFeatureFlagService(): FeatureFlagService {
  const flags = new Map<string, FeatureFlag>();

  return {
    register(flag) {
      flags.set(flag.name, flag);
    },
    isEnabled(name, context) {
      const flag = flags.get(name);
      if (!flag) return false;

      // Kill switch takes precedence (Section GX).
      if (flag.killSwitched) return false;

      // Status-based.
      if (flag.status === "disabled") return false;
      if (flag.status === "deprecated") return false;

      // Tenant-specific override.
      if (context.tenantId !== null) {
        const override = flag.tenantOverrides[context.tenantId];
        if (override !== undefined) return override;
      }

      // Percentage rollout.
      if (flag.rolloutPercentage < 100) {
        const hash = hashString(`${flag.name}:${context.rolloutKey}`);
        if (hash % 100 >= flag.rolloutPercentage) return false;
      }

      return flag.enabledByDefault;
    },
    setTenantOverride(name, tenantId, enabled) {
      const flag = flags.get(name);
      if (!flag) return false;
      flag.tenantOverrides[tenantId] = enabled;
      return true;
    },
    emergencyDisable(name) {
      const flag = flags.get(name);
      if (!flag || !flag.killSwitchEnabled) return false;
      flag.killSwitched = true;
      return true;
    },
    emergencyEnable(name) {
      const flag = flags.get(name);
      if (!flag) return false;
      flag.killSwitched = false;
      return true;
    },
    list() {
      return Array.from(flags.values());
    },
  };
}

/** Simple deterministic string hash for percentage rollout. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
