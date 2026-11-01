/**
 * Internal Console home snapshot. Operator-gated, no fabricated metrics.
 *
 * Homepage reads do not require AAL2 so staff can see operational status
 * after sign-in. Privileged writes remain AAL2-gated in staff.functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildHealthReport } from "@/lib/observability/health";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { CONSOLE_PATHS } from "./paths";
import { presentationRoleFor, presentationRoleLabel, viewerCapabilities } from "./roles";
import { overallFromCards, mapProcessHealth, type ConsoleHealthState } from "./status";
import { workspacesForViewer } from "./workspaces";
import { defaultRoleWorkspaceCode, mappingForRole } from "./role-workspace";
import { store } from "./store";
import { REGISTERED_RUNTIMES } from "./runtime-contract";
import { allowedHrefsFrom } from "./recent";
import type {
  ConsoleActivityItem,
  ConsoleAttentionItem,
  ConsoleHealthCard,
  ConsoleMetric,
  ConsoleOverview,
  ConsoleStaffRow,
} from "./overview";
import type { OrganizationMetricsSnapshot } from "./organization-lifecycle";

const timeAuthority = new TimeAuthority(new SystemClock());

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function requestHost(): string | null {
  try {
    return new URL(getRequest().url).host || null;
  } catch {
    return null;
  }
}

function environmentLabel(): { environment: string; source: string } {
  const vercel = (process.env.VERCEL_ENV ?? "").trim();
  if (vercel === "production") return { environment: "Production", source: "VERCEL_ENV" };
  if (vercel === "preview") return { environment: "Preview", source: "VERCEL_ENV" };
  if (vercel === "development") return { environment: "Development", source: "VERCEL_ENV" };
  const node = (process.env.NODE_ENV ?? "").trim();
  if (node)
    return {
      environment: node === "production" ? "Production" : "Development",
      source: "NODE_ENV",
    };
  return { environment: "Unknown", source: "not configured" };
}

function describeAction(action: string): string {
  const map: Record<string, string> = {
    "platform_staff.invite": "A staff invitation was created",
    "platform_staff.resend_invite": "A staff invitation was resent",
    "platform_staff.status.suspended": "A staff member was suspended",
    "platform_staff.status.revoked": "A staff member was revoked",
    "platform_staff.status.active": "A staff member was restored",
    "platform_staff.set_roles": "Staff roles were changed",
    "platform_support.grant": "Time-limited support access was granted",
    "platform_support.revoke": "Support access was revoked",
    "platform_access_review.view": "An access review was opened",
    "platform_workspace.create": "A shared workspace was created",
    "platform_workspace.member.add": "A workspace member was added",
    "platform_workspace.member.remove": "A workspace member was removed",
    "platform_workspace.archive": "A shared workspace was archived",
    "platform_organization.create": "An organization case was created",
    "platform_organization.draft.save": "Organization onboarding progress was saved",
    "platform_organization.submit": "An organization questionnaire was submitted",
    "platform_organization.state.submitted": "An organization was submitted for review",
    "platform_organization.state.under_review": "An organization entered review",
    "platform_organization.state.provisioning": "Organization provisioning started",
    "platform_organization.state.provisioning_failed": "Organization provisioning failed",
    "platform_organization.state.ready_for_activation": "An organization is ready for activation",
    "platform_organization.state.active": "An organization was activated",
    "platform_organization.state.suspended": "An organization was suspended",
    "platform_organization.state.deactivated": "An organization was deactivated",
    "platform_organization.provision": "Organization provisioning completed",
    "platform_organization.assign": "Staff were assigned to an organization",
    "platform_organization.assignment.release": "An organization assignment was released",
    "platform_ticket.create": "A support ticket was opened",
    "platform_ticket.status": "A support ticket status changed",
    "platform_incident.create": "An operational incident was filed",
    "platform_incident.status": "An operational incident status changed",
    "platform_billing.subscription.init": "A school subscription checkout was started",
    "platform_console.logs.search": "Control-plane logs were searched",
  };
  return map[action] ?? action.replace(/[._]/g, " ");
}

export const getConsoleOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConsoleOverview> => {
    const { error: claimError } = await context.supabase.rpc("claim_platform_staff_invite");
    if (claimError) throw new Error("Invitation claim could not be completed.");
    const { data: isStaff, error: staffErr } = await (context.supabase as unknown as RpcClient).rpc(
      "is_platform_staff",
    );
    if (staffErr || isStaff !== true) throw new Error("Not authorized");

    const { assertConsoleCapability } = await import("./console-access.server");
    const now = timeAuthority.now().at;
    const { environment, source: environmentSource } = environmentLabel();
    const { data: superRow } = await context.supabase
      .from("super_admins")
      .select("id, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const isSuperAdmin = Boolean(superRow);
    if (isSuperAdmin) {
      await assertConsoleCapability(context as never, "platform.operations.read", "overview.read");
    }
    const { data: staffRow } = await context.supabase
      .from("platform_staff")
      .select("id, full_name, email, status, platform_staff_roles(role_code)")
      .eq("id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    const roles = ((staffRow?.platform_staff_roles ?? []) as Array<{ role_code: string }>).map(
      (row) => row.role_code,
    );
    const capabilities = viewerCapabilities(roles, isSuperAdmin);
    const claimEmail =
      typeof (context.claims as { email?: unknown }).email === "string"
        ? (context.claims as { email: string }).email
        : "";
    const name = superRow?.full_name ?? staffRow?.full_name ?? (claimEmail || "Staff member");
    const email = superRow?.email ?? staffRow?.email ?? claimEmail;

    const healthReport = await buildHealthReport();
    const processStatus = mapProcessHealth(healthReport.status);

    let databaseStatus: ConsoleHealthState = "unknown";
    let databaseDetail = "The database check did not complete.";
    try {
      const db = await admin();
      const { error } = await db.from("platform_roles").select("code").limit(1);
      if (error) {
        databaseStatus = "unavailable";
        databaseDetail = "The required database health query failed.";
      } else {
        databaseStatus = "operational";
        databaseDetail =
          "The platform catalogue query succeeded. This does not prove every workflow.";
      }
    } catch {
      databaseStatus = "unavailable";
      databaseDetail = "The database probe could not run.";
    }

    const cards: ConsoleHealthCard[] = [
      {
        key: "platform",
        name: "Overall Platform Status",
        status: processStatus,
        detail:
          "Derived from the application process health report. A passing process is not proof that every workflow is functioning.",
        lastCheck: healthReport.ts,
        href: CONSOLE_PATHS.activityMetrics,
        source: "/health.json via buildHealthReport",
      },
      {
        key: "scholar",
        name: "Sherivs Scholar",
        status: processStatus,
        detail:
          "Sherivs Scholar runs on this application process. This check does not prove every school workflow is functioning.",
        lastCheck: healthReport.ts,
        href: CONSOLE_PATHS.scholar,
        source: "same application process as /health.json",
      },
      {
        key: "auth",
        name: "Authentication",
        status: "operational",
        detail:
          "This request was authenticated. That does not prove every sign-in or recovery workflow is functioning.",
        lastCheck: now,
        href: CONSOLE_PATHS.account,
        source: "requireSupabaseAuth for this request",
      },
      {
        key: "database",
        name: "Database",
        status: databaseStatus,
        detail: databaseDetail,
        lastCheck: now,
        href: CONSOLE_PATHS.activityMetrics,
        source: "platform_roles catalogue query",
      },
      {
        key: "storage",
        name: "Storage",
        status: "unknown",
        detail: "Storage operations are not monitored on this page.",
        lastCheck: null,
        href: CONSOLE_PATHS.activityMetrics,
        source: "not configured",
      },
      {
        key: "integrations",
        name: "Critical Integrations",
        status: "unknown",
        detail: "Provider health is measured by verification drills, not this homepage.",
        lastCheck: null,
        href: CONSOLE_PATHS.activityMetrics,
        source: "not configured on homepage",
      },
      {
        key: "incidents",
        name: "Active Incidents",
        status: "unknown",
        detail: "Open operational incidents have not been counted yet.",
        lastCheck: null,
        href: CONSOLE_PATHS.activityIncidents,
        source: "platform_incident",
      },
    ];

    const metrics: ConsoleMetric[] = [
      {
        key: "api-error",
        name: "API Error Rate",
        value: null,
        unit: "%",
        window: "not measured",
        source: "not configured",
        updatedAt: null,
        available: false,
        definition:
          "Eligible failed API requests divided by eligible API requests. Not collected in V1.",
      },
      {
        key: "api-latency",
        name: "API Latency",
        value: null,
        unit: "ms",
        window: "not measured",
        source: "not configured",
        updatedAt: null,
        available: false,
        definition: "Response-time percentiles for eligible API requests. Not collected in V1.",
      },
      {
        key: "incidents",
        name: "Active Incidents",
        value: null,
        unit: "count",
        window: "current",
        source: "platform_incident",
        updatedAt: null,
        available: false,
        definition:
          "Incidents currently open, acknowledged, or mitigating. Closed records are excluded.",
      },
      {
        key: "uptime",
        name: "Application Process Uptime",
        value: String(Math.round(healthReport.uptime_s)),
        unit: "seconds",
        window: "since process start",
        source: "buildHealthReport process snapshot",
        updatedAt: healthReport.ts,
        available: true,
        definition: "Operating-system process uptime for this application instance.",
      },
    ];

    const canStaff = capabilities.has("platform.staff.read");
    const canAudit = capabilities.has("platform.audit.read");
    let staff: ConsoleStaffRow[] = [];
    let pendingInvitations: number | null = null;
    let expiredInvitations: number | null = null;
    let activeStaff: number | null = null;

    if (canStaff) {
      const db = await admin();
      let data: unknown = null;
      let error: { message: string; code?: string } | null = null;
      const withExpiry = await store(db)
        .from("platform_staff")
        .select(
          "id, email, full_name, department, status, invited_at, activated_at, invite_expires_at, platform_staff_roles(role_code)",
        )
        .order("invited_at", { ascending: false })
        .limit(500);
      data = withExpiry.data;
      error = withExpiry.error;
      if (error) {
        const retry = await db
          .from("platform_staff")
          .select(
            "id, email, full_name, department, status, invited_at, activated_at, platform_staff_roles(role_code)",
          )
          .order("invited_at", { ascending: false })
          .limit(500);
        data = retry.data;
        error = retry.error;
      }
      if (!error) {
        staff = (
          (data ?? []) as Array<{
            id: string;
            email: string;
            full_name: string;
            department: string | null;
            status: string;
            invited_at: string | null;
            activated_at: string | null;
            invite_expires_at?: string | null;
            platform_staff_roles: Array<{ role_code: string }> | null;
          }>
        ).map((row) => ({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          department: row.department,
          status: row.status,
          invitedAt: row.invited_at,
          activatedAt: row.activated_at,
          inviteExpiresAt: row.invite_expires_at ?? null,
          roles: (row.platform_staff_roles ?? []).map((x) => x.role_code),
        }));
        pendingInvitations = staff.filter((row) => row.status === "invited").length;
        expiredInvitations = staff.filter(
          (row) =>
            row.status === "invited" && row.inviteExpiresAt !== null && row.inviteExpiresAt < now,
        ).length;
        activeStaff = staff.filter((row) => row.status === "active").length;
      }
    }

    const activity: ConsoleActivityItem[] = [];
    if (canAudit) {
      const db = await admin();
      const { data } = await db
        .from("audit_logs")
        .select("id, action, user_id, record_id, created_at, new_value")
        .or(
          "action.like.platform_staff.%,action.like.platform_support.%,action.like.platform_access_review.%,action.like.platform_workspace.%,action.like.platform_organization.%",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      const actorIds = [
        ...new Set((data ?? []).map((row) => row.user_id).filter(Boolean)),
      ] as string[];
      const names = new Map<string, string>();
      if (actorIds.length) {
        const { data: people } = await db
          .from("platform_staff")
          .select("id, full_name, email")
          .in("id", actorIds);
        for (const person of people ?? []) names.set(person.id, person.full_name || person.email);
        const { data: supers } = await db
          .from("super_admins")
          .select("id, full_name, email")
          .in("id", actorIds);
        for (const person of supers ?? []) names.set(person.id, person.full_name || person.email);
      }
      for (const row of data ?? []) {
        const payload = (row.new_value ?? {}) as {
          outcome?: string;
          details?: Record<string, unknown>;
        };
        activity.push({
          id: String(row.id),
          description: describeAction(row.action),
          actor: row.user_id ? (names.get(row.user_id) ?? "Staff member") : null,
          target: row.record_id,
          at: row.created_at ?? now,
          outcome: typeof payload.outcome === "string" ? payload.outcome : "recorded",
          action: row.action,
        });
      }
    }

    const attention: ConsoleAttentionItem[] = [];
    for (const card of cards) {
      if (card.status === "unavailable") {
        attention.push({
          id: `health-${card.key}`,
          severity: "critical",
          title: `${card.name} is unavailable`,
          description: card.detail,
          detectedAt: card.lastCheck ?? now,
          resource: card.name,
          owner: null,
          nextAction: "Open health details",
          href: card.href,
        });
      } else if (card.status === "degraded") {
        attention.push({
          id: `health-${card.key}`,
          severity: "high",
          title: `${card.name} is degraded`,
          description: card.detail,
          detectedAt: card.lastCheck ?? now,
          resource: card.name,
          owner: null,
          nextAction: "Review operational status",
          href: card.href,
        });
      }
    }
    if (typeof pendingInvitations === "number" && pendingInvitations > 0) {
      attention.push({
        id: "pending-invites",
        severity: "medium",
        title: `${pendingInvitations} staff invitation${pendingInvitations === 1 ? "" : "s"} pending`,
        description: "Invitations exist but have not been accepted. An invitation is not access.",
        detectedAt: now,
        resource: "Team & Access",
        owner: null,
        nextAction: "Review invitations",
        href: CONSOLE_PATHS.teamInvitations,
      });
    }
    if (typeof expiredInvitations === "number" && expiredInvitations > 0) {
      attention.push({
        id: "expired-invites",
        severity: "medium",
        title: `${expiredInvitations} staff invitation${expiredInvitations === 1 ? "" : "s"} expired`,
        description: "Expired invitations cannot be accepted. Resend or revoke them.",
        detectedAt: now,
        resource: "Team & Access",
        owner: null,
        nextAction: "Review invitations",
        href: CONSOLE_PATHS.teamInvitations,
      });
    }

    if (canStaff) {
      metrics.push({
        key: "active-staff",
        name: "Active Internal Staff",
        value: activeStaff === null ? null : String(activeStaff),
        unit: "people",
        window: "current active memberships",
        source: "platform_staff.status = active",
        updatedAt: now,
        available: activeStaff !== null,
        definition:
          "Sherivs staff rows currently in status active. Customer-school users are excluded.",
      });
      metrics.push({
        key: "pending-invites",
        name: "Pending Staff Invitations",
        value: pendingInvitations === null ? null : String(pendingInvitations),
        unit: "invitations",
        window: "current",
        source: "platform_staff.status = invited",
        updatedAt: now,
        available: pendingInvitations !== null,
        definition: "Staff rows in status invited. Delivery is not implied.",
      });
    }

    if (canStaff && activeStaff !== null && staff.length) {
      const invited = staff.filter((row) => row.invitedAt).length;
      metrics.push({
        key: "invitation-acceptance",
        name: "Staff invitation acceptance rate",
        value: invited === 0 ? null : String(Math.round((activeStaff / invited) * 1000) / 10),
        unit: "%",
        window: "current staff directory",
        source: "platform_staff",
        updatedAt: now,
        available: invited > 0,
        definition:
          "Active staff divided by staff rows that have an invitation timestamp. Delivery is not implied.",
      });
    }

    const presentationRole = presentationRoleFor({ isSuperAdmin, roles });
    const db = await admin();
    const {
      ensurePersonalWorkspace,
      ensureRegisteredRuntimes,
      loadAuthorizedWorkspaces,
      loadRecentAccess,
      loadRegisteredRuntimes,
      syncStaffWorkspaces,
    } = await import("./workspace.store.server");
    await ensurePersonalWorkspace(db, context.userId);
    await syncStaffWorkspaces(db, context.userId);
    await ensureRegisteredRuntimes(db);
    const canManageWorkspaces = capabilities.has("platform.staff.manage");
    const storedWorkspaces = await loadAuthorizedWorkspaces(
      db,
      context.userId,
      name,
      canManageWorkspaces,
    );
    const workspaces =
      storedWorkspaces ?? workspacesForViewer({ displayName: name, isSuperAdmin, roles });
    const runtimes = (await loadRegisteredRuntimes(db)) ?? [...REGISTERED_RUNTIMES];
    const allowedRecent = allowedHrefsFrom([
      ...workspaces,
      { href: CONSOLE_PATHS.home },
      { href: CONSOLE_PATHS.scholar },
      { href: CONSOLE_PATHS.team },
      { href: CONSOLE_PATHS.organizations },
      { href: CONSOLE_PATHS.help },
    ]);
    const recent = (await loadRecentAccess(db, context.userId, allowedRecent)) ?? [];

    const emptyOrgMetrics: OrganizationMetricsSnapshot = {
      available: false,
      source: "not authorized or not configured",
      total: null,
      active: null,
      onboarding: null,
      suspended: null,
      failedProvisioning: null,
      submitted: null,
      conversionRate: null,
      medianOnboardingHours: null,
    };
    let organizationMetrics: OrganizationMetricsSnapshot = emptyOrgMetrics;
    let organizations: ConsoleOverview["organizations"] = [];
    let organizationStore: ConsoleOverview["organizationStore"] = "unavailable";
    let assignments: ConsoleOverview["assignments"] = [];
    let scholarTenants: number | null = null;
    let registeredUsers: number | null = null;
    let activeUsers30d: number | null = null;
    if (capabilities.has("platform.tenants.read") || capabilities.has("platform.operations.read")) {
      if (isSuperAdmin) {
        await assertConsoleCapability(
          context as never,
          "platform.operations.read",
          "organization.summary.read",
        );
      }
      const { loadAssignedSupportOrganizationIds, loadOrganizationMetrics, loadViewerAssignments } =
        await import("./organization.store.server");
      try {
        const supportOnly =
          capabilities.has("platform.support.handle") &&
          !capabilities.has("platform.tenants.manage");
        const organizationIds = supportOnly
          ? await loadAssignedSupportOrganizationIds(db, context.userId)
          : undefined;
        const snapshot = await loadOrganizationMetrics(
          db,
          supportOnly
            ? { organizationIds, includePlatformMetrics: false }
            : isSuperAdmin
              ? { operationsSummary: true }
              : undefined,
        );
        organizationMetrics = snapshot.organizationMetrics;
        organizationStore = snapshot.organizationMetrics.available ? "database" : "unavailable";
        scholarTenants = snapshot.scholarTenants;
        registeredUsers = snapshot.registeredUsers;
        activeUsers30d = snapshot.activeUsers30d;
        organizations = snapshot.rows.slice(0, 8).map((row) => ({
          id: row.id,
          displayName: row.display_name,
          orgType: "school" as const,
          lifecycleState:
            row.lifecycle_state as ConsoleOverview["organizations"][number]["lifecycleState"],
          country: row.country,
          region: row.region,
          city: row.city,
          intendedRuntime: "scholar",
          enabledRuntime: row.enabled_runtime,
          schoolId: row.school_id,
          slug: row.slug,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          submittedAt: row.submitted_at,
          provisionedAt: row.provisioned_at,
          activatedAt: row.activated_at,
          onboardingOwnerName: null,
          assignmentCount: 0,
        }));
        assignments = await loadViewerAssignments(db, context.userId);
        if (organizationMetrics.available) {
          const pushMetric = (
            key: string,
            name: string,
            value: string | null,
            unit: string,
            definition: string,
            source: string,
            available: boolean,
          ) => {
            metrics.push({
              key,
              name,
              value,
              unit,
              window: "current",
              source,
              updatedAt: now,
              available,
              definition,
            });
          };
          pushMetric(
            "control-plane-organizations",
            "Control-plane organizations",
            organizationMetrics.total === null ? null : String(organizationMetrics.total),
            "organizations",
            "Organization lifecycle cases recorded by Sherivs staff.",
            "platform_organization",
            organizationMetrics.total !== null,
          );
          pushMetric(
            "active-organizations",
            "Active organizations",
            organizationMetrics.active === null ? null : String(organizationMetrics.active),
            "organizations",
            "Lifecycle cases in state active.",
            "platform_organization.lifecycle_state",
            organizationMetrics.active !== null,
          );
          pushMetric(
            "onboarding-organizations",
            "Organizations onboarding",
            organizationMetrics.onboarding === null ? null : String(organizationMetrics.onboarding),
            "organizations",
            "Cases that have started and are not yet active, suspended, or deactivated.",
            "platform_organization.lifecycle_state",
            organizationMetrics.onboarding !== null,
          );
          pushMetric(
            "suspended-organizations",
            "Suspended organizations",
            organizationMetrics.suspended === null ? null : String(organizationMetrics.suspended),
            "organizations",
            "Lifecycle cases in state suspended. Records are retained.",
            "platform_organization.lifecycle_state",
            organizationMetrics.suspended !== null,
          );
          if (
            typeof organizationMetrics.failedProvisioning === "number" &&
            organizationMetrics.failedProvisioning > 0
          ) {
            attention.push({
              id: "provisioning-failed",
              severity: "high",
              title: `${organizationMetrics.failedProvisioning} provisioning failure${organizationMetrics.failedProvisioning === 1 ? "" : "s"}`,
              description:
                "Provisioning failed for one or more organization cases. Retry is idempotent.",
              detectedAt: now,
              resource: "Organizations",
              owner: null,
              nextAction: "Open organization directory",
              href: CONSOLE_PATHS.organizations,
            });
          }
          if (
            typeof organizationMetrics.onboarding === "number" &&
            organizationMetrics.onboarding > 0
          ) {
            attention.push({
              id: "onboarding-pipeline",
              severity: "medium",
              title: `${organizationMetrics.onboarding} organization${organizationMetrics.onboarding === 1 ? "" : "s"} in the onboarding pipeline`,
              description: "These cases are not yet active.",
              detectedAt: now,
              resource: "Organizations",
              owner: null,
              nextAction: "Review onboarding",
              href: CONSOLE_PATHS.organizations,
            });
          }
        }
        if (registeredUsers !== null) {
          metrics.push({
            key: "registered-users",
            name: "Registered users",
            value: String(registeredUsers),
            unit: "people",
            window: "current",
            source: "public.users",
            updatedAt: now,
            available: true,
            definition:
              "Identity-store rows in public.users. Platform staff without a school membership are excluded.",
          });
        }
        if (activeUsers30d !== null) {
          metrics.push({
            key: "active-users-30d",
            name: "Active users (30 days)",
            value: String(activeUsers30d),
            unit: "people",
            window: "trailing 30 days",
            source: "auth.users.last_sign_in_at joined to public.users",
            updatedAt: now,
            available: true,
            definition:
              "Scholar users whose Auth last_sign_in_at is within 30 days. Account creation alone is not activity.",
          });
        }
        if (scholarTenants !== null) {
          metrics.push({
            key: "scholar-tenants",
            name: "Scholar tenant records",
            value: String(scholarTenants),
            unit: "tenants",
            window: "current",
            source: "public.schools",
            updatedAt: now,
            available: true,
            definition:
              "Rows in public.schools. Includes tenants not created through the Internal Console questionnaire.",
          });
        }
      } catch {
        organizationStore = "unavailable";
      }
    }

    const { countOpenIncidents, countSubscriptions } = await import("./operations.store.server");
    const openIncidentCount = await countOpenIncidents();
    const incidentCard = cards.find((card) => card.key === "incidents");
    if (incidentCard) {
      if (openIncidentCount === null) {
        incidentCard.status = "unknown";
        incidentCard.detail = "Incident storage is not applied or could not be read.";
        incidentCard.lastCheck = now;
      } else {
        incidentCard.status = "operational";
        incidentCard.detail =
          openIncidentCount === 0
            ? "No open operational incidents are recorded."
            : `${openIncidentCount} open operational incident${openIncidentCount === 1 ? "" : "s"} recorded.`;
        incidentCard.lastCheck = now;
      }
    }
    const incidentMetric = metrics.find((metric) => metric.key === "incidents");
    if (incidentMetric) {
      incidentMetric.value = openIncidentCount === null ? null : String(openIncidentCount);
      incidentMetric.updatedAt = now;
      incidentMetric.available = openIncidentCount !== null;
      incidentMetric.source =
        openIncidentCount === null ? "platform_incident not applied" : "platform_incident";
    }
    if (capabilities.has("platform.finance.read") || capabilities.has("platform.tenants.manage")) {
      const subscriptionCount = await countSubscriptions();
      metrics.push({
        key: "subscription-ledger",
        name: "Commercial subscriptions",
        value: subscriptionCount === null ? null : String(subscriptionCount),
        unit: "subscriptions",
        window: "current ledger",
        source:
          subscriptionCount === null
            ? "public.subscriptions not available"
            : "public.subscriptions",
        updatedAt: now,
        available: subscriptionCount !== null,
        definition:
          "Count of Paystack-oriented subscription payment-history rows. Not recognized revenue.",
      });
    }

    const preferredRole = defaultRoleWorkspaceCode({ isSuperAdmin, roles });
    const preferredMapping = preferredRole ? mappingForRole(preferredRole) : null;
    const currentWorkspace =
      workspaces.find(
        (workspace) =>
          preferredMapping &&
          (workspace.slug === preferredMapping.slug ||
            workspace.id === `role:${preferredMapping.roleCode}` ||
            workspace.name === preferredMapping.name),
      ) ??
      workspaces.find((workspace) => workspace.type === "role") ??
      workspaces[0];

    return {
      viewer: {
        id: context.userId,
        name,
        email,
        isSuperAdmin,
        roles,
        presentationRole,
        presentationLabel: presentationRoleLabel({ isSuperAdmin, roles }),
        capabilities: [...capabilities],
      },
      context: {
        organization: "Sherivs Internal",
        workspace: currentWorkspace?.name ?? "My Workspace",
        environment,
        environmentSource,
        host: requestHost(),
        version: healthReport.version,
      },
      health: {
        overall: overallFromCards(cards.map((card) => card.status)),
        cards,
        caveat:
          "These cards report verified checks only. Unknown means there is not enough evidence. A loaded homepage is not a health check.",
      },
      metrics,
      attention,
      activity,
      workspaces,
      workspaceStore: storedWorkspaces ? "database" : "derived-fallback",
      runtimes,
      recent,
      staff,
      staffAvailable: canStaff,
      pendingInvitations,
      expiredInvitations,
      activeStaff,
      usageDefinition:
        "Active internal staff means platform_staff rows with status active. This number never includes school administrators, teachers, students, or parents.",
      organizations,
      organizationStore,
      organizationMetrics,
      assignments,
      scholarTenants,
      registeredUsers,
      activeUsers30d,
    };
  });
