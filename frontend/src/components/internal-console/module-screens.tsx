import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  invitePlatformStaff,
  resendPlatformStaffInvite,
  setPlatformStaffRoles,
  setPlatformStaffStatus,
} from "@/lib/platform-staff/staff.functions";
import {
  addWorkspaceMember,
  archiveSharedWorkspace,
  createSharedWorkspace,
  removeWorkspaceMember,
} from "@/lib/internal-console/workspace.functions";
import {
  PLATFORM_ROLE_CODES,
  PLATFORM_ROLE_LABELS,
  PRIVILEGED_PLATFORM_ROLES,
} from "@/lib/platform-staff/catalogue";
import { listConsoleAudit } from "@/lib/internal-console/activity.functions";
import { CONSOLE_PATHS, SCHOLAR_ENTRY_URL } from "@/lib/internal-console/paths";
import { workspaceFromAuthorized } from "@/lib/internal-console/workspaces";
import {
  REGISTERED_RUNTIMES,
  SCHOLAR_RUNTIME_CONTRACT,
} from "@/lib/internal-console/runtime-contract";
import { helpArticlesFor } from "@/lib/internal-console/help-catalog";
import { CONSOLE_HEALTH_LABELS } from "@/lib/internal-console/status";
import { useApp } from "@/contexts/app-context";
import { useConsole } from "./console-shell";
import {
  presentationStaffStatus,
  type ConsoleActivityItem,
  type ConsoleStaffRow,
} from "@/lib/internal-console/overview";
import { workspaceTypeLabel } from "@/lib/internal-console/workspaces";
import { ROLE_WORKSPACE_MAPPINGS } from "@/lib/internal-console/role-workspace";
import { authorizedMetricContracts, metricContract } from "@/lib/internal-console/metrics";
import { consoleVisualFixtureActive } from "@/lib/internal-console/visual-fixture";
import { ConfirmAction, ConsoleNotice, StaffStatusBadge } from "./console-primitives";
import { ConsoleWorkspaceExperience } from "./workspace-screens";

function canManage(overviewCapabilities: string[]): boolean {
  return overviewCapabilities.includes("platform.staff.manage");
}

export function ConsoleTeamDirectory() {
  const { overview, reload, error: loadError } = useConsole();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    staffId: string;
    status: "active" | "suspended" | "revoked";
  } | null>(null);
  if (!overview) {
    return (
      <section className="sherivs-console-card">
        <p className="sherivs-console-page-kicker">Team & Access</p>
        <h1>Team Directory</h1>
        <p>{loadError ? loadError : "Loading team…"}</p>
        {loadError ? (
          <ConsoleNotice tone="error">The team directory could not be retrieved.</ConsoleNotice>
        ) : null}
      </section>
    );
  }
  if (!overview.staffAvailable) {
    return (
      <section className="sherivs-console-card">
        <h1>Team Directory</h1>
        <p>Team records are limited to authorized administrators.</p>
      </section>
    );
  }

  async function changeStatus(staffId: string, status: "active" | "suspended" | "revoked") {
    setBusy(staffId);
    setError(null);
    try {
      await setPlatformStaffStatus({ data: { staffId, status } });
      setPending(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sherivs-console-card" data-testid="console-team">
      <p className="sherivs-console-page-kicker">Team & Access</p>
      <h1>Team Directory</h1>
      <p>
        Active internal staff: {overview.activeStaff ?? "unavailable"}. Pending invitations:{" "}
        {overview.pendingInvitations ?? "unavailable"}. Expired invitations:{" "}
        {overview.expiredInvitations ?? "unavailable"}. {overview.usageDefinition}
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {overview.staff.length === 0 ? (
        <p className="sherivs-console-empty">No staff records in the authorized directory.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="sherivs-console-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Workspaces</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {overview.staff.map((row) => (
                <StaffRow
                  key={row.id}
                  row={row}
                  busy={busy === row.id}
                  canManage={canManage(overview.viewer.capabilities)}
                  isOwner={overview.viewer.isSuperAdmin}
                  nowIso={new Date().toISOString()}
                  sharedNames={overview.workspaces
                    .filter(
                      (workspace) =>
                        workspace.type !== "personal" &&
                        workspace.members.some((member) => member.userId === row.id),
                    )
                    .map((workspace) => workspace.name)}
                  pending={pending?.staffId === row.id ? pending.status : null}
                  onAskStatus={(status) => setPending({ staffId: row.id, status })}
                  onConfirmStatus={() =>
                    pending && void changeStatus(pending.staffId, pending.status)
                  }
                  onCancelStatus={() => setPending(null)}
                  onReload={reload}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StaffRow({
  row,
  busy,
  canManage: manage,
  isOwner,
  nowIso,
  sharedNames,
  pending,
  onAskStatus,
  onConfirmStatus,
  onCancelStatus,
  onReload,
}: {
  row: ConsoleStaffRow;
  busy: boolean;
  canManage: boolean;
  isOwner: boolean;
  nowIso: string;
  sharedNames: string[];
  pending: "active" | "suspended" | "revoked" | null;
  onAskStatus: (status: "active" | "suspended" | "revoked") => void;
  onConfirmStatus: () => void;
  onCancelStatus: () => void;
  onReload: () => Promise<void>;
}) {
  const [roles, setRoles] = useState(row.roles);
  const [savingRoles, setSavingRoles] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmRoles, setConfirmRoles] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    setRoles(row.roles);
  }, [row.id, row.roles]);
  const roleOptions = PLATFORM_ROLE_CODES.filter(
    (role) => isOwner || !PRIVILEGED_PLATFORM_ROLES.has(role),
  );
  const dirty = [...roles].sort().join(",") !== [...row.roles].sort().join(",");
  const presentation = presentationStaffStatus(row, nowIso);
  const privilegedChange = [...roles, ...row.roles].some((role) =>
    (PRIVILEGED_PLATFORM_ROLES as ReadonlySet<string>).has(role),
  );

  async function saveRoles() {
    if (!roles.length) {
      setRoleError("Assign at least one role.");
      return;
    }
    setSavingRoles(true);
    setRoleError(null);
    setInfo(null);
    try {
      await setPlatformStaffRoles({
        data: { staffId: row.id, roles: roles as (typeof PLATFORM_ROLE_CODES)[number][] },
      });
      setConfirmRoles(false);
      setInfo("Roles saved.");
      await onReload();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Role update failed");
    } finally {
      setSavingRoles(false);
    }
  }

  const statusQuestion =
    pending === "revoked"
      ? `Revoke ${row.fullName}? They lose roles and live sessions. This is not the same as removing them from a shared workspace.`
      : pending === "suspended"
        ? `Suspend ${row.fullName}? Live sessions will be blocked until restored.`
        : `Restore ${row.fullName} to active membership?`;

  return (
    <tr>
      <td>
        {row.fullName}
        {row.department ? <small> · {row.department}</small> : null}
      </td>
      <td>{row.email}</td>
      <td>
        {manage ? (
          <div>
            <p>
              Current:{" "}
              {row.roles
                .map(
                  (role) => PLATFORM_ROLE_LABELS[role as keyof typeof PLATFORM_ROLE_LABELS] ?? role,
                )
                .join(", ") || "none"}
            </p>
            <div className="sherivs-console-roles">
              {roleOptions.map((role) => (
                <label key={role}>
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() =>
                      setRoles((current) =>
                        current.includes(role)
                          ? current.filter((item) => item !== role)
                          : [...current, role],
                      )
                    }
                    aria-label={`${PLATFORM_ROLE_LABELS[role]} for ${row.fullName}`}
                  />
                  {PLATFORM_ROLE_LABELS[role]}
                </label>
              ))}
            </div>
            {privilegedChange && !isOwner ? (
              <p>Privileged role changes require the platform owner.</p>
            ) : null}
            {roleError ? <p className="sherivs-console-error">{roleError}</p> : null}
            {info ? <p>{info}</p> : null}
            {confirmRoles ? (
              <ConfirmAction
                question={`Save role changes for ${row.fullName}? Current: ${row.roles.join(", ") || "none"}. Proposed: ${roles.join(", ")}.`}
                confirmLabel="Save roles"
                busy={savingRoles}
                onConfirm={() => void saveRoles()}
                onCancel={() => setConfirmRoles(false)}
              />
            ) : (
              <button
                type="button"
                className="sherivs-console-btn secondary"
                disabled={!dirty || savingRoles || busy}
                onClick={() => setConfirmRoles(true)}
              >
                Review role changes
              </button>
            )}
          </div>
        ) : (
          row.roles
            .map((role) => PLATFORM_ROLE_LABELS[role as keyof typeof PLATFORM_ROLE_LABELS] ?? role)
            .join(", ")
        )}
      </td>
      <td>
        <StaffStatusBadge status={presentation} />
      </td>
      <td>
        {row.status === "active" ? "Personal" : "—"}
        {sharedNames.length ? ` · ${sharedNames.join(", ")}` : ""}
      </td>
      <td>
        {manage && (row.status === "invited" || presentation === "expired") ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() => void resendPlatformStaffInvite({ data: { staffId: row.id } })}
          >
            Resend
          </button>
        ) : null}
        {manage && row.status === "active" ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() => onAskStatus("suspended")}
          >
            Suspend
          </button>
        ) : null}
        {manage && row.status === "suspended" ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() => onAskStatus("active")}
          >
            Restore
          </button>
        ) : null}
        {isOwner && row.status !== "revoked" ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() => onAskStatus("revoked")}
          >
            Revoke
          </button>
        ) : null}
        {pending ? (
          <ConfirmAction
            question={statusQuestion}
            confirmLabel={
              pending === "revoked" ? "Revoke" : pending === "suspended" ? "Suspend" : "Restore"
            }
            busy={busy}
            onConfirm={onConfirmStatus}
            onCancel={onCancelStatus}
          />
        ) : null}
      </td>
    </tr>
  );
}

export function ConsoleInvitations() {
  const { overview, reload } = useConsole();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [roles, setRoles] = useState<string[]>(["operations"]);
  const [initialWorkspaceId, setInitialWorkspaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = overview ? canManage(overview.viewer.capabilities) : false;
  const pending = overview?.staff.filter((row) => row.status === "invited") ?? [];

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (consoleVisualFixtureActive()) {
      setError(
        "Invitation records are not written in the local visual fixture. Persistent staff storage is not connected.",
      );
      setBusy(false);
      return;
    }
    try {
      await invitePlatformStaff({
        data: {
          email,
          fullName,
          department: department || undefined,
          roles: roles as (typeof PLATFORM_ROLE_CODES)[number][],
          initialWorkspaceId: initialWorkspaceId || undefined,
        },
      });
      setEmail("");
      setFullName("");
      setInfo(
        "Invitation record created. Email delivery is handled by the auth provider and is not confirmed here.",
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  const roleOptions = PLATFORM_ROLE_CODES.filter(
    (role) => overview?.viewer.isSuperAdmin || !PRIVILEGED_PLATFORM_ROLES.has(role),
  );

  return (
    <section className="sherivs-console-card">
      <p className="sherivs-console-page-kicker">Team & Access</p>
      <h1>Invitations</h1>
      <p>
        An invitation is not access. Membership activates only after the invitee accepts and the
        staff row is active. Creating a record is not the same as delivery.
      </p>
      {manage ? (
        <form
          className="sherivs-console-form"
          onSubmit={(event) => void invite(event)}
          style={{ marginTop: "1rem" }}
        >
          <label>
            Full name
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              minLength={2}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Department
            <input value={department} onChange={(event) => setDepartment(event.target.value)} />
          </label>
          <div>
            <span>Roles</span>
            <div className="sherivs-console-roles">
              {roleOptions.map((role) => (
                <label key={role}>
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() =>
                      setRoles((current) =>
                        current.includes(role)
                          ? current.filter((item) => item !== role)
                          : [...current, role],
                      )
                    }
                  />
                  {PLATFORM_ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          <label>
            Initial workspace
            <select
              value={initialWorkspaceId}
              onChange={(event) => setInitialWorkspaceId(event.target.value)}
            >
              <option value="">Default from assigned role</option>
              {(overview?.workspaces ?? [])
                .filter(
                  (workspace) => workspace.type !== "personal" && workspace.source === "database",
                )
                .map((workspace) => (
                  <option key={workspace.recordId} value={workspace.recordId}>
                    {workspace.name}
                  </option>
                ))}
            </select>
          </label>
          {error ? <p className="sherivs-console-error">{error}</p> : null}
          {info ? <p>{info}</p> : null}
          <button
            type="submit"
            className="sherivs-console-btn"
            disabled={busy || roles.length === 0}
          >
            {busy ? "Sending…" : "Create invitation"}
          </button>
        </form>
      ) : (
        <p className="sherivs-console-empty">
          You can view invitations you are authorized to see. Creating invitations requires
          staff.manage.
        </p>
      )}
      <h2 style={{ marginTop: "1.4rem" }}>Pending</h2>
      {pending.length ? (
        <div className="sherivs-console-list">
          {pending.map((row) => (
            <div key={row.id} className="sherivs-console-row">
              <strong>{row.fullName}</strong>
              <small>
                {row.email} · invited{" "}
                {row.invitedAt ? new Date(row.invitedAt).toLocaleString() : "at unknown time"}
                {row.inviteExpiresAt
                  ? ` · expires ${new Date(row.inviteExpiresAt).toLocaleString()}`
                  : ""}
                {presentationStaffStatus(row, new Date().toISOString()) === "expired"
                  ? " · expired — resend required"
                  : ""}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="sherivs-console-empty">No pending invitations in the authorized directory.</p>
      )}
    </section>
  );
}

export function ConsoleRoleCatalogue() {
  const { overview } = useConsole();
  if (!overview) return <section className="sherivs-console-card">Loading roles…</section>;
  if (!overview.staffAvailable) {
    return (
      <section className="sherivs-console-card">
        <h1>Role catalogue</h1>
        <p>Role records are limited to authorized administrators.</p>
      </section>
    );
  }
  return (
    <section className="sherivs-console-card" data-testid="console-roles">
      <p className="sherivs-console-page-kicker">Team & Access</p>
      <h1>Role catalogue</h1>
      <p>
        These are the database-backed platform roles. Presentation labels such as Engineer map onto
        these codes. Workspace membership is not a capability grant.
      </p>
      <div className="sherivs-console-list" style={{ marginTop: "1rem" }}>
        {ROLE_WORKSPACE_MAPPINGS.map((mapping) => (
          <div key={mapping.roleCode} className="sherivs-console-row">
            <strong>
              {mapping.name}{" "}
              {mapping.inPlatformRoles ? `(${mapping.roleCode})` : "(super admin mapping)"}
            </strong>
            <small>{mapping.description}</small>
            <small>
              Default workspace: {mapping.name}. Capabilities still come from{" "}
              {mapping.inPlatformRoles ? "platform_roles" : "is_super_admin()"}.
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ConsoleSuspendedStaff() {
  const { overview } = useConsole();
  if (!overview) return <section className="sherivs-console-card">Loading staff…</section>;
  if (!overview.staffAvailable) {
    return (
      <section className="sherivs-console-card">
        <h1>Suspended and revoked</h1>
        <p>Staff records are limited to authorized administrators.</p>
      </section>
    );
  }
  const rows = overview.staff.filter(
    (row) => row.status === "suspended" || row.status === "revoked",
  );
  return (
    <section className="sherivs-console-card" data-testid="console-suspended">
      <p className="sherivs-console-page-kicker">Team & Access</p>
      <h1>Suspended and revoked</h1>
      <p>
        Suspension bans the auth account. Revocation also removes roles. Personal workspace
        ownership is preserved. Role-workspace membership is recalculated by the provisioning
        engine.
      </p>
      {rows.length === 0 ? (
        <p className="sherivs-console-empty">
          No suspended or revoked staff in the authorized directory.
        </p>
      ) : (
        <div className="sherivs-console-list">
          {rows.map((row) => (
            <div key={row.id} className="sherivs-console-row">
              <strong>{row.fullName}</strong>
              <small>
                {row.email} · {row.status} · {row.roles.join(", ") || "no roles"}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ConsoleWorkspaces() {
  const { overview, reload } = useConsole();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!overview) return <section className="sherivs-console-card">Loading workspaces…</section>;
  const canCreate =
    overview.viewer.isSuperAdmin || overview.viewer.capabilities.includes("platform.staff.manage");

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createSharedWorkspace({ data: { name, description: description || undefined } });
      setName("");
      setDescription("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace could not be created");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sherivs-console-card">
      <p className="sherivs-console-page-kicker">Workspaces</p>
      <h1>Workspaces</h1>
      <p>
        {overview.workspaceStore === "database"
          ? "Personal workspaces are private to their owner. Shared workspaces exist only for authorized members. Managing staff is not the same as opening someone else's personal workspace."
          : "Persistent workspace storage is not configured. This directory is a compatibility view from role membership and cannot hold custom members."}
      </p>
      {canCreate && overview.workspaceStore === "database" ? (
        <form
          className="sherivs-console-form"
          onSubmit={(event) => void create(event)}
          style={{ marginTop: "1rem" }}
        >
          <label>
            Shared workspace name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
            />
          </label>
          <label>
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {error ? <p className="sherivs-console-error">{error}</p> : null}
          <button type="submit" className="sherivs-console-btn" disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
      ) : null}
      <div className="sherivs-console-list">
        {overview.workspaces.map((workspace) => (
          <Link key={workspace.id} to={workspace.href as never} className="sherivs-console-row">
            <strong>{workspace.name}</strong>
            <small>
              {workspaceTypeLabel(workspace.type)} · {workspace.access}
              {workspace.source === "derived" ? " · compatibility" : ""}
            </small>
            <small>{workspace.description}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ConsoleWorkspaceDetail() {
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const { overview, reload } = useConsole();
  const [memberId, setMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  if (!overview) return <section className="sherivs-console-card">Loading workspace…</section>;
  const workspace = workspaceFromAuthorized(params.workspaceId ?? "me", overview.workspaces, {
    displayName: overview.viewer.name,
    isSuperAdmin: overview.viewer.isSuperAdmin,
    roles: overview.viewer.roles,
  });
  if (!workspace) {
    return (
      <section className="sherivs-console-card">
        <h1>Workspace unavailable</h1>
        <p>This workspace is not in your authorized set.</p>
      </section>
    );
  }
  const canManage =
    overview.viewer.isSuperAdmin || overview.viewer.capabilities.includes("platform.staff.manage");
  const members =
    workspace.type === "personal"
      ? [{ id: overview.viewer.id, name: overview.viewer.name, access: "owner" as const }]
      : workspace.source === "database"
        ? workspace.members.map((member) => ({
            id: member.userId,
            name:
              overview.staff.find((row) => row.id === member.userId)?.fullName ??
              (member.userId === overview.viewer.id ? overview.viewer.name : "Staff member"),
            access: member.access,
          }))
        : overview.staff
            .filter((row) => row.roles.some((role) => workspace.id === `role:${role}`))
            .map((row) => ({ id: row.id, name: row.fullName, access: "member" as const }));

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!workspace || workspace.source !== "database") return;
    setError(null);
    try {
      await addWorkspaceMember({ data: { workspaceId: workspace.recordId, userId: memberId } });
      setMemberId("");
      setInfo("Member added.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Member could not be added");
    }
  }

  return (
    <section className="sherivs-console-card">
      <p className="sherivs-console-page-kicker">Workspaces</p>
      <h1>{workspace.name}</h1>
      <p>{workspace.description}</p>
      <p>
        {workspaceTypeLabel(workspace.type)}. Access: {workspace.access}.{" "}
        {workspace.source === "database"
          ? "Persistent workspace."
          : "Compatibility workspace from role membership. Custom members cannot be stored here."}
      </p>
      <div style={{ marginTop: "1rem" }}>
        <ConsoleWorkspaceExperience workspace={workspace} overview={overview} />
      </div>
      <h2 style={{ marginTop: "1rem" }}>Members</h2>
      {members.length ? (
        <div className="sherivs-console-list">
          {members.map((member) => (
            <div key={member.id} className="sherivs-console-row">
              <strong>{member.name}</strong>
              <small>{member.access}</small>
              {canManage &&
              workspace.type === "shared" &&
              workspace.source === "database" &&
              member.access === "member" ? (
                removeId === member.id ? (
                  <ConfirmAction
                    question={`Remove ${member.name} from this shared workspace? Their personal workspace is not affected.`}
                    confirmLabel="Remove member"
                    onConfirm={() =>
                      void removeWorkspaceMember({
                        data: { workspaceId: workspace.recordId, userId: member.id },
                      })
                        .then(() => {
                          setRemoveId(null);
                          setInfo("Member removed.");
                          return reload();
                        })
                        .catch((err) =>
                          setError(
                            err instanceof Error ? err.message : "Member could not be removed",
                          ),
                        )
                    }
                    onCancel={() => setRemoveId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="sherivs-console-btn secondary"
                    onClick={() => setRemoveId(member.id)}
                  >
                    Remove
                  </button>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="sherivs-console-empty">
          Member names appear when you are authorized to read the staff directory.
        </p>
      )}
      {canManage && workspace.type === "shared" && workspace.source === "database" ? (
        <>
          <form
            className="sherivs-console-form"
            onSubmit={(event) => void addMember(event)}
            style={{ marginTop: "1rem" }}
          >
            <label>
              Add staff member
              <select
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                required
              >
                <option value="">Select staff</option>
                {overview.staff
                  .filter((row) => row.status === "active")
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.fullName}
                    </option>
                  ))}
              </select>
            </label>
            {error ? <p className="sherivs-console-error">{error}</p> : null}
            {info ? <p>{info}</p> : null}
            <button type="submit" className="sherivs-console-btn">
              Add member
            </button>
          </form>
          {confirmArchive ? (
            <ConfirmAction
              question="Archive this shared workspace? Members lose access. Personal workspaces are not deleted."
              confirmLabel="Archive workspace"
              onConfirm={() =>
                void archiveSharedWorkspace({ data: { workspaceId: workspace.recordId } })
                  .then(() => reload())
                  .catch((err) => setError(err instanceof Error ? err.message : "Archive failed"))
              }
              onCancel={() => setConfirmArchive(false)}
            />
          ) : (
            <button
              type="button"
              className="sherivs-console-btn secondary"
              style={{ marginTop: "0.75rem" }}
              onClick={() => setConfirmArchive(true)}
            >
              Archive workspace
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}

export function ConsoleRuntimes() {
  const { overview } = useConsole();
  const runtimes = overview?.runtimes?.length ? overview.runtimes : REGISTERED_RUNTIMES;
  return (
    <section className="sherivs-console-card">
      <h1>Runtime directory</h1>
      <p>
        Only registered, existing runtimes appear here. Future products are not listed as
        operational.
      </p>
      <div className="sherivs-console-list">
        {runtimes.map((runtime) => (
          <Link key={runtime.id} to={runtime.helpHref as never} className="sherivs-console-row">
            <strong>{runtime.name}</strong>
            <small>
              {runtime.id} · {runtime.status.replace("_", " ")}
            </small>
            <small>{runtime.description}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ConsoleScholarRuntime() {
  const { overview } = useConsole();
  const scholar = overview?.health.cards.find((card) => card.key === "scholar");
  return (
    <section className="sherivs-console-card">
      <h1>{SCHOLAR_RUNTIME_CONTRACT.name}</h1>
      <p>{SCHOLAR_RUNTIME_CONTRACT.description}</p>
      <p>
        Status: {scholar ? CONSOLE_HEALTH_LABELS[scholar.status] : "Unknown"}. {scholar?.detail}
      </p>
      <div className="sherivs-console-actions" style={{ marginTop: "1rem" }}>
        <a className="sherivs-console-btn" href={SCHOLAR_ENTRY_URL} rel="noreferrer">
          Launch Sherivs Scholar
        </a>
      </div>
      <p>
        Last health check:{" "}
        {scholar?.lastCheck ? new Date(scholar.lastCheck).toLocaleString() : "No successful check"}.
      </p>
      <p style={{ marginTop: "1rem" }}>
        Launch opens the Scholar application host with the current authenticated session. Platform
        staff without a school membership will not receive a school dashboard, by design.
      </p>
    </section>
  );
}

function AuditList({ scope }: { scope: "all" | "admin" | "security" }) {
  const { overview } = useConsole();
  const [events, setEvents] = useState<ConsoleActivityItem[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (consoleVisualFixtureActive()) {
      setEvents(scope === "security" ? [] : (overview?.activity ?? []));
      setSource(
        scope === "security"
          ? "local visual fixture — no security events are recorded"
          : "local visual fixture organization transitions — audit_logs were not queried",
      );
      return;
    }
    void listConsoleAudit({ data: { scope, limit: 80 } })
      .then((result) => {
        setEvents(result.events);
        setSource(result.source);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Audit records unavailable"));
  }, [scope, overview?.activity]);
  if (error) return <p className="sherivs-console-error">{error}</p>;
  if (!events) return <p>Loading authorized records…</p>;
  if (!events.length) {
    return (
      <>
        {source ? <p>Source: {source}. These are audit records, not application logs.</p> : null}
        <p className="sherivs-console-empty">No matching audit records.</p>
      </>
    );
  }
  return (
    <>
      <p>Source: {source}. These are audit records, not application logs.</p>
      <div className="sherivs-console-list">
        {events.map((event) => (
          <div key={event.id} className="sherivs-console-row">
            <strong>{event.description}</strong>
            <small>
              {event.action} · {event.outcome} · {event.actor ?? "unknown actor"} ·{" "}
              {new Date(event.at).toLocaleString()}
            </small>
            {event.correlationId ? <small>Correlation ID: {event.correlationId}</small> : null}
          </div>
        ))}
      </div>
    </>
  );
}

export function ConsoleActivity({ scope = "all" }: { scope?: "all" | "admin" | "security" }) {
  const { overview } = useConsole();
  const allowed = overview?.viewer.capabilities.includes("platform.audit.read");
  const title =
    scope === "security"
      ? "Security events"
      : scope === "admin"
        ? "Administrative events"
        : "Activity overview";
  return (
    <section className="sherivs-console-card">
      <h1>{title}</h1>
      <p>
        Audit records answer who performed an important action. They are not request logs, metrics,
        or a security operations centre.
      </p>
      {allowed ? <AuditList scope={scope} /> : <p>Audit records require the audit capability.</p>}
    </section>
  );
}

export function ConsoleMetrics() {
  const { overview } = useConsole();
  if (!overview) return <section className="sherivs-console-card">Loading metrics…</section>;
  const contractsForViewer = authorizedMetricContracts(new Set(overview.viewer.capabilities));
  if (contractsForViewer.length === 0) {
    return (
      <section className="sherivs-console-card">
        <h1>Metrics</h1>
        <p>No metrics are available to this viewer's capabilities.</p>
      </section>
    );
  }
  const measuredKeys = new Set((overview?.metrics ?? []).map((metric) => metric.key));
  const contracts = contractsForViewer.filter((contract) => !measuredKeys.has(contract.key));
  return (
    <section className="sherivs-console-card" data-testid="console-metrics">
      <p className="sherivs-console-page-kicker">Intelligence & Assurance</p>
      <h1>Metrics</h1>
      <p>
        Measured values include a definition, window, source, and last-updated time. Contracts
        without a live source stay unavailable instead of showing placeholder numbers.
      </p>
      <div className="sherivs-console-grid" style={{ marginTop: "0.9rem" }}>
        {(overview?.metrics ?? []).map((metric) => {
          const contract = metricContract(metric.key);
          return (
            <div key={metric.key} className="sherivs-console-row">
              <strong>{metric.name}</strong>
              <p>{metric.available ? `${metric.value} ${metric.unit}` : "Unavailable"}</p>
              <small>
                {metric.window} · {metric.source}
                {metric.updatedAt
                  ? ` · Updated ${new Date(metric.updatedAt).toLocaleString()}`
                  : ""}
              </small>
              <small>{metric.definition}</small>
              {contract ? (
                <small>
                  Calculation: {contract.calculation}. Freshness: {contract.freshness}.
                  Authorization: {contract.authorization}.
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      {contracts.length ? (
        <>
          <h2 style={{ marginTop: "1.5rem" }}>Defined but not collected here</h2>
          <div className="sherivs-console-list">
            {contracts.map((contract) => (
              <div key={contract.key} className="sherivs-console-row">
                <strong>{contract.name}</strong>
                <small>
                  {contract.source} · {contract.window} · {contract.authorization}
                </small>
                <small>{contract.definition}</small>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function ConsoleAccount() {
  const app = useApp();
  const { overview } = useConsole();
  return (
    <section className="sherivs-console-card">
      <h1>Account & Preferences</h1>
      <p>
        {overview?.viewer.name} · {overview?.viewer.email} · {overview?.viewer.presentationLabel}
      </p>
      <p>Roles: {overview?.viewer.roles.join(", ") || "none assigned beyond owner status"}.</p>
      <div className="sherivs-console-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="sherivs-console-btn secondary"
          onClick={() => void app.signOut()}
        >
          Sign out
        </button>
      </div>
      <h2 style={{ marginTop: "1.5rem" }}>Passkeys</h2>
      <p className="sherivs-console-empty">
        Passkeys are registered and used in the Sherivs iOS and Android apps, not in this browser.
      </p>
      <p className="sherivs-console-empty" style={{ marginTop: "1rem" }}>
        Theme, language, timezone, and notification switches are not configured. Profile fields
        other than the authenticated identity are not editable from this page.
      </p>
    </section>
  );
}

export function ConsoleSettings() {
  const { overview } = useConsole();
  return (
    <section className="sherivs-console-card">
      <h1>Platform settings</h1>
      <p>Sherivs Internal. This is not a tenant and not a school.</p>
      <div className="sherivs-console-list">
        <div className="sherivs-console-row">
          <strong>Environment</strong>
          <small>
            {overview?.context.environment} · source {overview?.context.environmentSource}
          </small>
        </div>
        <div className="sherivs-console-row">
          <strong>Application version</strong>
          <small>{overview?.context.version ?? "Not reported by the health snapshot"}</small>
        </div>
        <div className="sherivs-console-row">
          <strong>Host</strong>
          <small>{overview?.context.host ?? "Unknown"}</small>
        </div>
        <div className="sherivs-console-row">
          <strong>Onboarding defaults</strong>
          <small>
            Organization type: school. Runtime: Sherivs Scholar. These defaults are the supported V1
            configuration, not a generic settings framework.
          </small>
        </div>
      </div>
    </section>
  );
}

export function ConsoleHelp() {
  const { overview } = useConsole();
  const articles = helpArticlesFor({
    isSuperAdmin: overview?.viewer.isSuperAdmin ?? false,
    capabilities: new Set(overview?.viewer.capabilities ?? []),
  });
  return (
    <section className="sherivs-console-card">
      <h1>Help & Support</h1>
      <div className="sherivs-console-list">
        {articles.map((article) => (
          <Link key={article.id} to={article.href as never} className="sherivs-console-row">
            <strong>{article.title}</strong>
            <small>{article.description}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}
