/**
 * JARVIS-LIVE-01: the governed service identity of JARVIS (Authority: Owner; Origin: owner
 * instruction of 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * JARVIS is not a person and has no password, no human session and no way to sign in as one. It
 * acts as the service principal `svc:jarvis`, which is:
 *   - named in every audit record it writes (actor_ref = svc:jarvis, kind agent);
 *   - limited to a short allow-list of permissions, with an explicit deny-list that no
 *     configuration can widen (deciding an approval, reading secrets, moving money);
 *   - suspendable at any time from the registry row, after which the tick does nothing;
 *   - a short-lived-credential identity: it holds no static login of its own. Credentials for
 *     outside systems live in the connector vault and are issued by the owner.
 *
 * Pure: the registry row and the clock are passed in.
 */
import type { ServiceIdentity } from "../identity";

export const JARVIS_SERVICE_CODE = "jarvis";
export const JARVIS_SERVICE_ACTOR = `svc:${JARVIS_SERVICE_CODE}` as const;

export const JARVIS_PERMISSIONS = Object.freeze([
  "signals.read",
  "owner_alert.write",
  "owner_alert.deliver",
  "approval.request",
  "tool_ledger.read",
] as const);
export type JarvisPermission = (typeof JARVIS_PERMISSIONS)[number];

/** Never grantable to JARVIS, whatever a row or a config says. */
export const JARVIS_DENIED = Object.freeze([
  "approval.decide",
  "secrets.read",
  "finance.write",
  "credentials.create",
  "identity.create",
  "policy.change",
  "migration.apply",
  "production.deploy",
] as const);

export type ServiceStatus = "active" | "suspended" | "revoked";

export interface ServiceRegistryRow {
  readonly code: string;
  readonly status: ServiceStatus;
  readonly permissions: readonly string[];
}

export type ServiceDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "not_registered" | "not_active" | "denied_permission" | "not_granted";
    };

const isDenied = (p: string): boolean => (JARVIS_DENIED as readonly string[]).includes(p);

/**
 * Whether the registry row lets JARVIS use a permission. A missing, suspended or revoked row
 * allows nothing. A denied permission is refused even when a row lists it.
 */
export function authorizeService(
  row: ServiceRegistryRow | null,
  permission: string,
): ServiceDecision {
  if (!row || row.code !== JARVIS_SERVICE_CODE) return { allowed: false, reason: "not_registered" };
  if (row.status !== "active") return { allowed: false, reason: "not_active" };
  if (isDenied(permission)) return { allowed: false, reason: "denied_permission" };
  if (
    !row.permissions.includes(permission) ||
    !(JARVIS_PERMISSIONS as readonly string[]).includes(permission)
  ) {
    return { allowed: false, reason: "not_granted" };
  }
  return { allowed: true };
}

/** Registry rows that list a denied permission are invalid and should be rejected on read. */
export function registryRowIsValid(row: ServiceRegistryRow): boolean {
  return row.permissions.every((p) => !isDenied(p));
}

/** The identity as the platform's identity model describes it. */
export function jarvisServiceIdentity(ownerId: string, createdAt: string): ServiceIdentity {
  return {
    id: JARVIS_SERVICE_ACTOR as unknown as ServiceIdentity["id"],
    serviceName: "JARVIS executive",
    ownerId: ownerId as unknown as ServiceIdentity["ownerId"],
    environment: ["production"],
    permissions: [...JARVIS_PERMISSIONS] as unknown as ServiceIdentity["permissions"],
    credentialPolicy: "short_lived",
    createdAt,
  };
}
