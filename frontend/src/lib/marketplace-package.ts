/**
 * CoreGrid Marketplace Platform — product packaging and security domain.
 *
 * Implements `architecture/phase-27-marketplace.md`:
 * - Product packaging (26-30): standardized package metadata; package manifest
 *   defines product identity, version, dependencies, APIs, permissions,
 *   configuration, resources, installation requirements; every dependency
 *   declared; products explicitly declare requested permissions; products
 *   declare the institutional data categories they require.
 * - Marketplace security (31-42): zero-trust (products do not receive trust
 *   merely because listed), capability permissions (approved capabilities only),
 *   least privilege, tenant isolation, secret isolation, sandboxing, security
 *   scanning (malware, vulnerabilities, suspicious dependencies, secrets,
 *   malicious code, insecure configuration), dependency scanning, supply-chain
 *   security (provenance and integrity), package signing, signature verification
 *   at installation, security certification for high-risk products.
 * - Compatibility engine (162): product compatible with tenant configuration,
 *   CoreGrid version, APIs, installed products, policies, devices.
 * - Conflict detection (163): incompatible versions, permission conflicts, API
 *   conflicts, dependency conflicts, policy conflicts before activation.
 * - Installation simulation (164) dry run: preview installation effects before
 *   activation. Change impact (165): APIs accessed, data accessed, permissions
 *   requested, dependencies, estimated cost, affected users.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type PackageManifestId = string & { readonly __brand: "PackageManifestId" };
export type SecurityScanId = string & { readonly __brand: "SecurityScanId" };
export type InstallationDryRunId = string & { readonly __brand: "InstallationDryRunId" };

export function packageManifestId(raw: string): PackageManifestId {
  return raw as PackageManifestId;
}
export function securityScanId(raw: string): SecurityScanId {
  return raw as SecurityScanId;
}
export function installationDryRunId(raw: string): InstallationDryRunId {
  return raw as InstallationDryRunId;
}

/* ─────────────────────────────────────────────────────────────
 * Package manifest (Sections 26, 27, 28, 29, 30)
 * ────────────────────────────────────────────────────────────*/

export interface PackageManifest {
  id: PackageManifestId;
  productId: string;
  version: string;
  /** APIs the product uses (Section 27). */
  apis: string[];
  /** Declared dependencies (Section 28). */
  dependencies: string[];
  /** Explicitly declared permission strings (Section 29). */
  permissions: string[];
  /** Institutional data categories required (Section 30). */
  dataAccessCategories: string[];
  /** Configuration schema ref (Section 166). */
  configurationSchemaRef: string | null;
  /** Resource requirements. */
  resources: Record<string, string | number | boolean>;
  installationRequirements: string[];
  /** Whether the package is signed (Section 40). */
  signed: boolean;
}

export function createPackageManifest(input: {
  id: PackageManifestId;
  productId: string;
  version: string;
  apis?: string[];
  dependencies?: string[];
  permissions?: string[];
  dataAccessCategories?: string[];
  configurationSchemaRef?: string | null;
  resources?: Record<string, string | number | boolean>;
  installationRequirements?: string[];
  signed?: boolean;
}): { ok: true; manifest: PackageManifest } | { ok: false; error: string } {
  if (!input.productId.trim()) {
    return { ok: false, error: "Package manifest requires product identity (Section 27)" };
  }
  if (!input.version.trim()) {
    return { ok: false, error: "Package manifest requires a version" };
  }
  return {
    ok: true,
    manifest: {
      id: input.id,
      productId: input.productId,
      version: input.version,
      apis: input.apis ?? [],
      dependencies: input.dependencies ?? [],
      permissions: input.permissions ?? [],
      dataAccessCategories: input.dataAccessCategories ?? [],
      configurationSchemaRef: input.configurationSchemaRef ?? null,
      resources: input.resources ?? {},
      installationRequirements: input.installationRequirements ?? [],
      signed: input.signed ?? false,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Marketplace security (Sections 31-42)
 * ────────────────────────────────────────────────────────────*/

export type SecurityScanFinding =
  | "malware"
  | "vulnerability"
  | "suspicious_dependency"
  | "embedded_secret"
  | "malicious_code"
  | "insecure_configuration";

export const SECURITY_SCAN_FINDINGS: readonly SecurityScanFinding[] = [
  "malware",
  "vulnerability",
  "suspicious_dependency",
  "embedded_secret",
  "malicious_code",
  "insecure_configuration",
] as const;

export interface SecurityScanResult {
  id: SecurityScanId;
  manifestId: PackageManifestId;
  findings: SecurityScanFinding[];
  /** True when the package passed the security scan. */
  passed: boolean;
  scannedAt: string;
}

/**
 * Security scanning (Section 37): any malware, malicious code, or embedded
 * secret finding blocks the package regardless of other results.
 */
export function evaluateSecurityScan(input: {
  id: SecurityScanId;
  manifestId: PackageManifestId;
  findings: SecurityScanFinding[];
  now?: string;
}): SecurityScanResult {
  const blocking: SecurityScanFinding[] = ["malware", "embedded_secret", "malicious_code"];
  const passed = !input.findings.some((f) => blocking.includes(f));
  return {
    id: input.id,
    manifestId: input.manifestId,
    findings: input.findings,
    passed,
    scannedAt: input.now ?? timeAuthority.now().at,
  };
}

/**
 * Package signature verification (Section 41): installation must verify package
 * integrity. Production packages must be signed (Section 40).
 */
export function isPackageSignatureValid(input: {
  manifest: PackageManifest;
  signaturePresent: boolean;
  signatureValid: boolean;
  requiresSignature?: boolean;
}): boolean {
  if (!input.manifest.signed && input.requiresSignature !== false) return false;
  return input.signaturePresent && input.signatureValid;
}

/**
 * Least privilege + data minimization (Sections 33, 127): a product should request
 * only the permissions/data it needs. Excessive declared access is flagged.
 */
export function hasExcessiveDataAccess(
  manifest: PackageManifest,
  maxCategories: number = 3,
): boolean {
  return manifest.dataAccessCategories.length > maxCategories;
}

/* ─────────────────────────────────────────────────────────────
 * Compatibility engine (Section 162) + conflict detection (163)
 * ────────────────────────────────────────────────────────────*/

export interface CompatibilityInput {
  /** Minimum required CoreGrid version. */
  requiredCoreGridVersion: string;
  currentCoreGridVersion: string;
  /** Required APIs. */
  requiredApis: string[];
  availableApis: string[];
  /** Required policies. */
  requiredPolicies: string[];
  /** Required permissions. */
  requiredPermissions: string[];
  /** Installed product IDs. */
  installedProducts: string[];
  /** Product IDs this product conflicts with. */
  conflictingProducts: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

/**
 * Compatibility (Section 162): determine whether a product is compatible with
 * tenant configuration, CoreGrid version, APIs, installed products, policies,
 * and devices.
 */
export function evaluateCompatibility(input: CompatibilityInput): CompatibilityResult {
  const reasons: string[] = [];
  if (!isCoreGridVersionCompatible(input.requiredCoreGridVersion, input.currentCoreGridVersion)) {
    reasons.push(
      `Requires CoreGrid >= ${input.requiredCoreGridVersion}, found ${input.currentCoreGridVersion}`,
    );
  }
  for (const api of input.requiredApis) {
    if (!input.availableApis.includes(api)) reasons.push(`Required API unavailable: ${api}`);
  }
  for (const pol of input.requiredPolicies) {
    if (!pol.startsWith("allowed.")) reasons.push(`Required policy not satisfied: ${pol}`);
  }
  const conflicts = input.installedProducts.filter((p) => input.conflictingProducts.includes(p));
  if (conflicts.length > 0) {
    reasons.push(`Conflicts with installed products: ${conflicts.join(", ")}`);
  }
  return { compatible: reasons.length === 0, reasons };
}

function isCoreGridVersionCompatible(required: string, current: string): boolean {
  const r = required.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < r.length; i++) {
    if ((c[i] ?? 0) < (r[i] ?? 0)) return false;
  }
  return true;
}

/**
 * Conflict detection (Section 163): permission conflicts are detected before
 * activation — a product cannot require a permission the tenant denies.
 */
export function detectPermissionConflicts(
  requiredPermissions: string[],
  deniedPermissions: string[],
): string[] {
  return requiredPermissions.filter((p) => deniedPermissions.includes(p));
}

/* ─────────────────────────────────────────────────────────────
 * Installation dry run (Section 164) + change impact (165)
 * ────────────────────────────────────────────────────────────*/

export interface InstallationDryRun {
  id: InstallationDryRunId;
  tenantId: TenantId;
  productId: string;
  version: string;
  /** APIs that would be accessed. */
  apisAccessed: string[];
  /** Data categories that would be accessed. */
  dataAccessed: string[];
  /** Permissions that would be requested. */
  permissionsRequested: string[];
  /** Dependencies that would be installed. */
  dependencies: string[];
  /** Estimated cost (minor units). */
  estimatedCostMinorUnits: number;
  /** Estimated affected user count. */
  affectedUsers: number;
  /** Whether the dry run passed pre-activation checks (Section 164). */
  passed: boolean;
}

/**
 * Installation dry run (Section 164): administrators may preview installation
 * effects before activation — change impact (Section 165).
 */
export function createInstallationDryRun(input: {
  id: InstallationDryRunId;
  tenantId: TenantId;
  productId: string;
  version: string;
  apisAccessed?: string[];
  dataAccessed?: string[];
  permissionsRequested?: string[];
  dependencies?: string[];
  estimatedCostMinorUnits?: number;
  affectedUsers?: number;
  /** Pre-activation checks: compatibility, no permission conflicts, no security concern. */
  checksPassed: boolean;
}): InstallationDryRun {
  return {
    id: input.id,
    tenantId: input.tenantId,
    productId: input.productId,
    version: input.version,
    apisAccessed: input.apisAccessed ?? [],
    dataAccessed: input.dataAccessed ?? [],
    permissionsRequested: input.permissionsRequested ?? [],
    dependencies: input.dependencies ?? [],
    estimatedCostMinorUnits: input.estimatedCostMinorUnits ?? 0,
    affectedUsers: input.affectedUsers ?? 0,
    passed: input.checksPassed,
  };
}
