import type { ReactElement } from "react";
import { Link } from "@tanstack/react-router";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { CONSOLE_HEALTH_LABELS, type ConsoleHealthState } from "@/lib/internal-console/status";
import { ORGANIZATION_LIFECYCLE_LABELS } from "@/lib/internal-console/organization-lifecycle";
import { quickActionsFor } from "@/lib/internal-console/roles";
import { allowedHrefsFrom, readRecentResources } from "@/lib/internal-console/recent";
import { SCHOLAR_RUNTIME_CONTRACT } from "@/lib/internal-console/runtime-contract";
import type { ConsoleOverview } from "@/lib/internal-console/overview";
import type { InternalWorkspace } from "@/lib/internal-console/workspaces";
import {
  WORKSPACE_EXPERIENCES,
  experienceKeyForWorkspace,
  visibleWorkspaceNav,
  type WorkspaceExperienceKey,
} from "@/lib/internal-console/workspace-experience";
import { SupportTenantPanel } from "./support-access-screens";

function StatusBadge({ status }: { status: ConsoleHealthState }) {
  return (
    <span className={`sherivs-console-status is-${status}`}>
      <i />
      {CONSOLE_HEALTH_LABELS[status]}
    </span>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="sherivs-console-empty">{children}</p>;
}

function NavLinks({
  experienceKey,
  overview,
}: {
  experienceKey: WorkspaceExperienceKey;
  overview: ConsoleOverview;
}) {
  const links = visibleWorkspaceNav(WORKSPACE_EXPERIENCES[experienceKey], {
    isSuperAdmin: overview.viewer.isSuperAdmin,
    capabilities: new Set(overview.viewer.capabilities),
  });
  if (!links.length)
    return <Empty>No additional destinations are authorized in this workspace.</Empty>;
  return (
    <div className="sherivs-console-list">
      {links.map((item) => (
        <Link
          key={`${item.href}-${item.label}`}
          to={item.href as never}
          search={item.search as never}
          className="sherivs-console-row"
        >
          <strong>{item.label}</strong>
          <small>{item.search?.state ? `Filter: ${item.search.state}` : item.href}</small>
        </Link>
      ))}
    </div>
  );
}

function OrgQueue({ overview }: { overview: ConsoleOverview }) {
  if (!overview.organizationMetrics.available) {
    return (
      <Empty>
        Organization lifecycle storage is not configured, so this workspace cannot show a live
        queue.
      </Empty>
    );
  }
  const counts = [
    {
      state: "submitted",
      label: "Awaiting review",
      value: overview.organizations.filter((row) => row.lifecycleState === "submitted").length,
    },
    {
      state: "under_review",
      label: "Under review",
      value: overview.organizations.filter((row) => row.lifecycleState === "under_review").length,
    },
    {
      state: "provisioning_failed",
      label: "Provisioning failed",
      value: overview.organizationMetrics.failedProvisioning ?? 0,
    },
    {
      state: "ready_for_activation",
      label: "Ready for activation",
      value: overview.organizations.filter((row) => row.lifecycleState === "ready_for_activation")
        .length,
    },
    { state: "active", label: "Active", value: overview.organizationMetrics.active ?? 0 },
    { state: "suspended", label: "Suspended", value: overview.organizationMetrics.suspended ?? 0 },
  ];
  return (
    <div className="sherivs-console-grid">
      {counts.map((item) => (
        <Link
          key={item.state}
          to={CONSOLE_PATHS.organizations as never}
          search={{ state: item.state } as never}
          className="sherivs-console-row"
        >
          <strong>{item.label}</strong>
          <small>
            {item.value} ·{" "}
            {
              ORGANIZATION_LIFECYCLE_LABELS[
                item.state as keyof typeof ORGANIZATION_LIFECYCLE_LABELS
              ]
            }
          </small>
        </Link>
      ))}
    </div>
  );
}

function SubscriptionBoundary() {
  return (
    <section>
      <h2>Subscriptions and entitlements</h2>
      <p>
        Tenant access is controlled by organization lifecycle and schools.is_active. Payment history
        lives in public.subscriptions and is shown on Billing. That ledger is not recognized revenue
        or MRR.
      </p>
      <Link to={CONSOLE_PATHS.activityBilling as never} className="sherivs-console-btn secondary">
        Open billing
      </Link>
    </section>
  );
}

function PlatformOperationsExperience({ overview }: { overview: ConsoleOverview }) {
  const actions = quickActionsFor({
    isSuperAdmin: overview.viewer.isSuperAdmin,
    capabilities: new Set(overview.viewer.capabilities),
  });
  const measured = overview.metrics.filter((metric) => metric.available);
  return (
    <>
      {overview.organizationMetrics.available ? (
        <section>
          <h2>Organization lifecycle</h2>
          <p>
            {overview.organizationMetrics.onboarding ?? 0} onboarding ·{" "}
            {overview.organizationMetrics.active ?? 0} active ·{" "}
            {overview.organizationMetrics.suspended ?? 0} suspended. Source:{" "}
            {overview.organizationMetrics.source}.
          </p>
          <OrgQueue overview={overview} />
        </section>
      ) : (
        <section>
          <h2>Organization lifecycle</h2>
          <Empty>Lifecycle counts are unavailable until organization storage is configured.</Empty>
        </section>
      )}
      <section>
        <h2>Attention required</h2>
        {overview.attention.length ? (
          <div className="sherivs-console-list">
            {overview.attention.map((item) => (
              <Link key={item.id} to={item.href as never} className="sherivs-console-row">
                <strong>
                  {item.severity.toUpperCase()} · {item.title}
                </strong>
                <small>{item.description}</small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>No verified items need attention right now.</Empty>
        )}
      </section>
      <section>
        <h2>Verified runtime health</h2>
        <p>{overview.health.caveat}</p>
        <div className="sherivs-console-grid" style={{ marginTop: "0.8rem" }}>
          {overview.health.cards.map((card) => (
            <Link key={card.key} to={card.href as never} className="sherivs-console-row">
              <strong>{card.name}</strong>
              <StatusBadge status={card.status} />
              <small>
                {card.detail} · Source: {card.source}
                {card.lastCheck ? "" : " · No successful check"}
              </small>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2>Authorized platform metrics</h2>
        {measured.length ? (
          <div className="sherivs-console-grid">
            {measured.map((metric) => (
              <div key={metric.key} className="sherivs-console-row">
                <strong>{metric.name}</strong>
                <small>
                  {metric.value} {metric.unit} · {metric.source}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No measured platform metrics are available to this viewer.</Empty>
        )}
      </section>
      <section>
        <h2>Assigned operational work</h2>
        {overview.assignments.length ? (
          <div className="sherivs-console-list">
            {overview.assignments.map((assignment) => (
              <Link
                key={assignment.id}
                to={CONSOLE_PATHS.organization(assignment.organizationId) as never}
                className="sherivs-console-row"
              >
                <strong>{assignment.staffName ?? assignment.organizationId}</strong>
                <small>
                  {assignment.assignmentType} · {assignment.status}
                </small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>
            No organization assignments are recorded for you. Sherivs V1 does not include a general
            task system.
          </Empty>
        )}
      </section>
      <section>
        <h2>Quick actions</h2>
        <div className="sherivs-console-actions">
          {actions.map((action) => (
            <Link
              key={action.key}
              to={action.href as never}
              className="sherivs-console-btn secondary"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>
      <SubscriptionBoundary />
    </>
  );
}

function PlatformAdministrationExperience({ overview }: { overview: ConsoleOverview }) {
  if (!overview.staffAvailable) {
    return <Empty>Staff records are limited to authorized administrators.</Empty>;
  }
  return (
    <>
      <section>
        <h2>Staff directory summary</h2>
        <p>
          Active internal staff: {overview.activeStaff ?? "unavailable"}. Pending invitations:{" "}
          {overview.pendingInvitations ?? "unavailable"}. Expired invitations:{" "}
          {overview.expiredInvitations ?? "unavailable"}.
        </p>
        <p>{overview.usageDefinition}</p>
        <div className="sherivs-console-actions" style={{ marginTop: "0.8rem" }}>
          <Link to={CONSOLE_PATHS.team as never} className="sherivs-console-btn secondary">
            Open team directory
          </Link>
          <Link
            to={CONSOLE_PATHS.teamInvitations as never}
            className="sherivs-console-btn secondary"
          >
            Invitations
          </Link>
        </div>
      </section>
      <section>
        <h2>Access review</h2>
        <p>
          A platform administrator cannot grant super-admin privileges. Role assignment is validated
          against the existing capability model.
        </p>
        <Link to={CONSOLE_PATHS.teamAccess as never} className="sherivs-console-btn secondary">
          Review access
        </Link>
      </section>
      <section>
        <h2>Workspace membership</h2>
        <p>
          {overview.workspaceStore === "database"
            ? "Persistent workspaces are available. Personal workspaces stay private."
            : "Persistent workspace storage is not configured. Compatibility workspaces cannot hold custom members."}
        </p>
        <Link to={CONSOLE_PATHS.workspaces as never} className="sherivs-console-btn secondary">
          Open workspace directory
        </Link>
      </section>
      <section>
        <h2>Platform configuration</h2>
        <p>
          Environment: {overview.context.environment} ({overview.context.environmentSource}).
        </p>
        <Link to={CONSOLE_PATHS.settings as never} className="sherivs-console-btn secondary">
          Platform settings
        </Link>
      </section>
    </>
  );
}

function OperationsExperience({ overview }: { overview: ConsoleOverview }) {
  const assigned = overview.assignments;
  return (
    <>
      <section>
        <h2>Onboarding and lifecycle queue</h2>
        <p>
          Operations staff manage organization cases. They do not receive unrestricted school data
          from this workspace.
        </p>
        <OrgQueue overview={overview} />
      </section>
      <section>
        <h2>Assigned organization cases</h2>
        {assigned.length ? (
          <div className="sherivs-console-list">
            {assigned.map((assignment) => (
              <Link
                key={assignment.id}
                to={CONSOLE_PATHS.organization(assignment.organizationId) as never}
                className="sherivs-console-row"
              >
                <strong>{assignment.staffName ?? assignment.organizationId}</strong>
                <small>
                  {assignment.assignmentType} · {assignment.status}
                </small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>No organization assignments are recorded for you.</Empty>
        )}
      </section>
      <section>
        <h2>Onboarding performance</h2>
        {overview.organizationMetrics.available ? (
          <p>
            Completion rate:{" "}
            {overview.organizationMetrics.conversionRate === null
              ? "not calculated"
              : `${Math.round(overview.organizationMetrics.conversionRate * 1000) / 10}%`}
            . Median hours: {overview.organizationMetrics.medianOnboardingHours ?? "not calculated"}
            . Source: {overview.organizationMetrics.source}.
          </p>
        ) : (
          <Empty>Onboarding performance is unavailable without organization storage.</Empty>
        )}
      </section>
    </>
  );
}

function EngineeringExperience({ overview }: { overview: ConsoleOverview }) {
  const canReadOrgs =
    overview.viewer.isSuperAdmin || overview.viewer.capabilities.includes("platform.tenants.read");
  const failed = canReadOrgs ? overview.organizationMetrics.failedProvisioning : null;
  return (
    <>
      <section>
        <h2>Verified application health</h2>
        <p>{overview.health.caveat}</p>
        <div className="sherivs-console-grid" style={{ marginTop: "0.8rem" }}>
          {overview.health.cards.map((card) => (
            <div key={card.key} className="sherivs-console-row">
              <strong>{card.name}</strong>
              <StatusBadge status={card.status} />
              <small>
                {card.detail} · Source: {card.source}
                {card.lastCheck ? ` · ${card.lastCheck}` : " · No successful check"}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Runtime availability</h2>
        <p>
          {SCHOLAR_RUNTIME_CONTRACT.name}: {SCHOLAR_RUNTIME_CONTRACT.status.replace("_", " ")}. A
          reachable runtime is not a completed school onboarding.
        </p>
        <Link to={CONSOLE_PATHS.scholar as never} className="sherivs-console-btn secondary">
          Open Scholar runtime
        </Link>
      </section>
      <section>
        <h2>Failed provisioning operations</h2>
        {typeof failed === "number" && failed > 0 ? (
          <Link
            to={CONSOLE_PATHS.organizations as never}
            search={{ state: "provisioning_failed" } as never}
            className="sherivs-console-row"
          >
            <strong>
              {failed} provisioning failure{failed === 1 ? "" : "s"}
            </strong>
            <small>Retry is idempotent and does not create duplicate schools.</small>
          </Link>
        ) : (
          <Empty>
            {overview.organizationMetrics.available
              ? "No provisioning failures are recorded."
              : "Provisioning diagnostics require organization storage."}
          </Empty>
        )}
      </section>
      <section>
        <h2>Deployment information</h2>
        <Empty>
          No authorized deployment workflow is connected to this console. Deployment actions stay
          unavailable.
        </Empty>
      </section>
      <section>
        <h2>Available logs</h2>
        <p>
          Control-plane audit actions can be searched. Process health remains at /health.json. This
          workspace does not invent log rows or expose secrets.
        </p>
        <div className="sherivs-console-actions">
          <Link to={CONSOLE_PATHS.activityLogs as never} className="sherivs-console-btn secondary">
            Search logs
          </Link>
          <Link
            to={CONSOLE_PATHS.activityIncidents as never}
            className="sherivs-console-btn secondary"
          >
            Open incidents
          </Link>
        </div>
      </section>
    </>
  );
}

function SupportExperience({ overview }: { overview: ConsoleOverview }) {
  return (
    <>
      <section>
        <h2>Assigned organizations</h2>
        {overview.assignments.length ? (
          <div className="sherivs-console-list">
            {overview.assignments.map((assignment) => (
              <Link
                key={assignment.id}
                to={CONSOLE_PATHS.organization(assignment.organizationId) as never}
                className="sherivs-console-row"
              >
                <strong>{assignment.staffName ?? assignment.organizationId}</strong>
                <small>
                  {assignment.assignmentType} · {assignment.status}
                </small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>
            No organizations are assigned to you. Open Tickets to file an onboarding or access case.
          </Empty>
        )}
      </section>
      <SupportTenantPanel />
      <section>
        <h2>Onboarding assistance</h2>
        <p>
          Support may inspect authorized organization lifecycle status. Student records, fees, and
          biometric data are not available here.
        </p>
        <Link to={CONSOLE_PATHS.organizations as never} className="sherivs-console-btn secondary">
          Open organization directory
        </Link>
      </section>
      <section>
        <h2>Runtime availability</h2>
        <p>
          {SCHOLAR_RUNTIME_CONTRACT.name} is the only operational runtime. Launch does not grant a
          school dashboard to platform staff without school membership.
        </p>
      </section>
      <section>
        <h2>Escalation</h2>
        <p>Support tickets are organization cases, not school complaints or student records.</p>
        <Link to={CONSOLE_PATHS.activityTickets as never} className="sherivs-console-btn secondary">
          Open tickets
        </Link>
      </section>
    </>
  );
}

function PersonalExperience({ overview }: { overview: ConsoleOverview }) {
  const allowed = allowedHrefsFrom([
    ...overview.workspaces,
    { href: CONSOLE_PATHS.home },
    { href: CONSOLE_PATHS.account },
    { href: CONSOLE_PATHS.help },
  ]);
  const recent = overview.recent.length ? overview.recent : readRecentResources(allowed);
  const roleWorkspaces = overview.workspaces.filter((workspace) => workspace.type === "role");
  return (
    <>
      <section>
        <h2>Identity</h2>
        <p>
          {overview.viewer.name} · {overview.viewer.email} · {overview.viewer.presentationLabel}
        </p>
        <p>Roles: {overview.viewer.roles.join(", ") || "none assigned beyond owner status"}.</p>
        <p>
          Current workspace context: {overview.context.workspace} · {overview.context.environment}.
        </p>
      </section>
      <section>
        <h2>Recently accessed</h2>
        {recent.length ? (
          <div className="sherivs-console-list">
            {recent.map((item) => (
              <Link key={item.id} to={item.href as never} className="sherivs-console-row">
                <strong>{item.title}</strong>
                <small>{item.kind}</small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>Recently accessed resources appear here after you open an authorized page.</Empty>
        )}
      </section>
      <section>
        <h2>Assigned work</h2>
        {overview.assignments.length ? (
          <div className="sherivs-console-list">
            {overview.assignments.map((assignment) => (
              <Link
                key={assignment.id}
                to={CONSOLE_PATHS.organization(assignment.organizationId) as never}
                className="sherivs-console-row"
              >
                <strong>{assignment.assignmentType}</strong>
                <small>{assignment.status}</small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>
            No documents, notes, or personal files are stored in V1. Assignments appear only when
            organization ownership is recorded.
          </Empty>
        )}
      </section>
      <section>
        <h2>Notifications</h2>
        <Empty>
          A notification inbox is not configured. Verified attention items appear on Home.
        </Empty>
      </section>
      <section>
        <h2>Role workspaces</h2>
        {roleWorkspaces.length ? (
          <div className="sherivs-console-list">
            {roleWorkspaces.map((workspace) => (
              <Link key={workspace.id} to={workspace.href as never} className="sherivs-console-row">
                <strong>{workspace.name}</strong>
                <small>{workspace.description}</small>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>
            No role workspaces are assigned. Standard team members work from this personal
            workspace.
          </Empty>
        )}
      </section>
      <div className="sherivs-console-actions">
        <Link to={CONSOLE_PATHS.account as never} className="sherivs-console-btn secondary">
          Account and preferences
        </Link>
      </div>
    </>
  );
}

function SharedExperience() {
  return (
    <Empty>
      This is a custom shared workspace. Membership is explicit. Role tools live on role workspaces,
      not here.
    </Empty>
  );
}

const EXPERIENCE_BODY: Record<WorkspaceExperienceKey, (overview: ConsoleOverview) => ReactElement> =
  {
    platform_operations: (overview) => <PlatformOperationsExperience overview={overview} />,
    platform_administration: (overview) => <PlatformAdministrationExperience overview={overview} />,
    operations: (overview) => <OperationsExperience overview={overview} />,
    engineering: (overview) => <EngineeringExperience overview={overview} />,
    support: (overview) => <SupportExperience overview={overview} />,
    personal: (overview) => <PersonalExperience overview={overview} />,
    shared: () => <SharedExperience />,
  };

export function ConsoleWorkspaceExperience({
  workspace,
  overview,
}: {
  workspace: InternalWorkspace;
  overview: ConsoleOverview;
}) {
  const key = experienceKeyForWorkspace(workspace);
  const contract = WORKSPACE_EXPERIENCES[key];
  return (
    <div data-testid={`console-workspace-${key}`} className="sherivs-console-workspace-experience">
      <p>
        <strong>Purpose.</strong> {contract.purpose}
      </p>
      <p>
        <strong>Membership.</strong> {contract.membership} {contract.privacy}
      </p>
      <p>
        <strong>Lifecycle.</strong> {contract.lifecycle} {contract.revocation}
      </p>
      {EXPERIENCE_BODY[key](overview)}
      <section>
        <h2>Workspace destinations</h2>
        <NavLinks experienceKey={key} overview={overview} />
      </section>
    </div>
  );
}
