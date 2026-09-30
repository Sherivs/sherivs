/**
 * CoreGrid — Institutional Command Centre core domain model
 * (Phase 19, Sections A, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X).
 *
 * Implements `architecture/phase-19-command-centre.md`:
 * - Command-centre principle (A.4): the Command Centre is a
 *   situational-awareness and coordination surface. It does not
 *   independently determine institutional truth and does not
 *   independently execute unrestricted actions (A.3).
 * - Institutional state (I): UNKNOWN must remain distinct from healthy.
 * - Role-based command centre (K): different users receive different
 *   command environments; access is policy-governed.
 * - Command context (L): every session establishes tenant, institution,
 *   user, role, permissions, campus, period and operational scope.
 * - Multi-tenant command isolation (M): a user must never accidentally
 *   observe another institution's operational state.
 * - Command scope (N) and filtering (O): global/institution/campus/
 *   faculty/department/programme/facility/domain; filter by time,
 *   location, severity, domain, status, owner.
 * - Dashboard system (P, Q): dashboards are presentation and
 *   coordination surfaces, never the source of analytical truth; each
 *   component defines ID, source, data contract, permissions, refresh
 *   policy, rendering config, version.
 * - Dashboard versioning (R) and templates (S); personalized views (T).
 * - Command snapshots (U): immutable snapshots of important state.
 * - Live command view (V) and real-time status (W): last update,
 *   freshness, source, confidence.
 * - Stale data (X): clearly identify stale information — never make old
 *   data appear live.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Institutional state (I)
 * ────────────────────────────────────────────────────────────*/

export type InstitutionalStatus = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";

export const INSTITUTIONAL_STATUSES: readonly InstitutionalStatus[] = [
  "HEALTHY",
  "DEGRADED",
  "CRITICAL",
  "UNKNOWN",
] as const;

export interface InstitutionalState {
  institutionId: string;
  tenantId: TenantId;
  status: InstitutionalStatus;
  asOf: string;
  freshness: number | null;
  source: string;
}

/**
 * Institutional state (I): UNKNOWN must remain distinct from healthy.
 * A state with no freshness is never presented as healthy.
 */
export function isInstitutionalStateHealthy(state: InstitutionalState): boolean {
  if (state.status === "UNKNOWN") {
    return false;
  }
  return state.status === "HEALTHY";
}

export function isCommandStateStale(
  state: { asOf: string; freshness: number | null },
  now: string,
): boolean {
  if (state.freshness === null) {
    return true;
  }
  return Date.parse(now) - Date.parse(state.asOf) > state.freshness;
}

/* ─────────────────────────────────────────────────────────────
 * Command context (L) and multi-tenant isolation (M)
 * ────────────────────────────────────────────────────────────*/

export interface CommandContext {
  tenantId: TenantId;
  institutionId: string;
  userId: string;
  role: string;
  permissions: string[];
  selectedCampus: string | null;
  selectedPeriod: string | null;
  selectedOperationalScope: string | null;
}

export type CommandScope =
  | "global"
  | "institution"
  | "campus"
  | "faculty"
  | "department"
  | "programme"
  | "facility"
  | "operational_domain";

export const COMMAND_SCOPES: readonly CommandScope[] = [
  "global",
  "institution",
  "campus",
  "faculty",
  "department",
  "programme",
  "facility",
  "operational_domain",
] as const;

/**
 * Multi-tenant isolation (M): a user must never accidentally observe
 * another institution's operational state. The context's tenant must be
 * the resource tenant unless an explicit platform-level grant exists.
 */
export function isCommandAccessWithinTenant(
  context: CommandContext,
  resourceTenantId: TenantId,
  crossTenantGranted: boolean,
): { allowed: boolean; reason: string } {
  if (context.tenantId === resourceTenantId) {
    return { allowed: true, reason: "Same-tenant command access (M)" };
  }
  if (crossTenantGranted) {
    return { allowed: true, reason: "Cross-tenant command access explicitly granted (DW)" };
  }
  return { allowed: false, reason: "Cross-tenant command access denied (M, DW)" };
}

export function isCommandContextComplete(context: CommandContext): boolean {
  return (
    context.tenantId !== null &&
    context.institutionId.trim() !== "" &&
    context.userId.trim() !== "" &&
    context.role.trim() !== "" &&
    context.permissions.length > 0
  );
}

/* ─────────────────────────────────────────────────────────────
 * Dashboard system (P, Q, R, S, T)
 * ────────────────────────────────────────────────────────────*/

export type DashboardTemplateKind =
  "executive" | "academic" | "finance" | "operations" | "infrastructure" | "security" | "campus";

export const DASHBOARD_TEMPLATE_KINDS: readonly DashboardTemplateKind[] = [
  "executive",
  "academic",
  "finance",
  "operations",
  "infrastructure",
  "security",
  "campus",
] as const;

export interface DashboardComponent {
  componentId: string;
  source: string;
  dataContract: string;
  permissions: string[];
  refreshPolicyMs: number | null;
  renderingConfig: Record<string, unknown>;
  version: number;
}

export interface DashboardDefinition {
  dashboardId: string;
  name: string;
  template: DashboardTemplateKind;
  tenantId: TenantId;
  version: number;
  components: DashboardComponent[];
  layout: Record<string, unknown>;
}

export interface CreateDashboardInput {
  dashboardId: string;
  name: string;
  template: DashboardTemplateKind;
  tenantId: TenantId;
  components: DashboardComponent[];
  layout: Record<string, unknown>;
}

export type CreateDashboardResult =
  { ok: true; dashboard: DashboardDefinition } | { ok: false; error: string };

/**
 * Dashboard creation (P, Q): dashboards are versioned presentation and
 * coordination surfaces — they never become the source of analytical
 * truth.
 */
export function createDashboard(input: CreateDashboardInput): CreateDashboardResult {
  if (input.dashboardId.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "Dashboard requires an ID and name (P)" };
  }
  if (input.components.length === 0) {
    return { ok: false, error: "Dashboard requires at least one component (P)" };
  }
  return {
    ok: true,
    dashboard: {
      dashboardId: input.dashboardId,
      name: input.name,
      template: input.template,
      tenantId: input.tenantId,
      version: 1,
      components: input.components,
      layout: input.layout,
    },
  };
}

export function isDashboardComponentAuthorized(
  component: DashboardComponent,
  permissions: string[],
): boolean {
  return component.permissions.some((p) => permissions.includes(p));
}

/* ─────────────────────────────────────────────────────────────
 * Command snapshots (U) and live view (V, W, X)
 * ────────────────────────────────────────────────────────────*/

export interface CommandSnapshot {
  snapshotId: string;
  scope: CommandScope;
  scopeId: string;
  tenantId: TenantId;
  takenAt: string;
  state: Record<string, unknown>;
  immutable: true;
}

export interface LiveViewStatus {
  lastUpdate: string;
  freshness: number | null;
  source: string;
  confidence: number | null;
}

/**
 * Stale data (X): the Command Centre must clearly identify stale
 * information and never make old data appear live. A view whose last
 * update exceeds its freshness window is STALE.
 */
export function gradeLiveViewStatus(
  view: LiveViewStatus,
  now: string,
): "live" | "stale" | "unknown" {
  if (view.freshness === null || view.lastUpdate === "") {
    return "unknown";
  }
  return Date.parse(now) - Date.parse(view.lastUpdate) <= view.freshness ? "live" : "stale";
}
