import { useEffect, useState, type FormEvent } from "react";
import {
  grantSupportAccess,
  listSupportGrants,
  readSupportTenantSummary,
  revokeSupportAccess,
  getAccessReview,
  SUPPORT_GRANT_MAX_HOURS,
} from "@/lib/platform-staff/support-access.functions";
import {
  grantableSupportOrganizations,
  grantableSupportStaff,
} from "@/lib/platform-staff/support-access";
import { consoleVisualFixtureActive } from "@/lib/internal-console/visual-fixture";
import { PLATFORM_ROLE_LABELS } from "@/lib/platform-staff/catalogue";
import { useConsole } from "./console-shell";
import { ConfirmAction, ConsoleNotice } from "./console-primitives";

const GRANT_HOURS = Array.from({ length: SUPPORT_GRANT_MAX_HOURS }, (_, index) => index + 1);

export function ConsoleAccessReview() {
  const { overview } = useConsole();
  const [data, setData] = useState<Awaited<ReturnType<typeof getAccessReview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [organizationKey, setOrganizationKey] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(1);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const canAudit = Boolean(overview?.viewer.capabilities.includes("platform.audit.read"));
  const canGrant = Boolean(overview?.viewer.isSuperAdmin);
  const eligibleStaff = grantableSupportStaff(data?.staff ?? []);
  const eligibleOrganizations = grantableSupportOrganizations(overview?.organizations ?? []);

  async function load() {
    try {
      const review = await getAccessReview();
      setData(review);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access review unavailable");
    }
  }

  useEffect(() => {
    if (!canAudit) return;
    if (consoleVisualFixtureActive()) {
      setError("Access review is not queried in the local visual fixture.");
      return;
    }
    void load();
  }, [canAudit]);

  async function grant(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (consoleVisualFixtureActive()) {
      setError(
        "Support grants are not written in the local visual fixture. Persistent grant storage is not connected.",
      );
      setBusy(false);
      return;
    }
    try {
      const result = await grantSupportAccess({
        data: {
          staffId,
          schoolId: organizationKey,
          reason,
          hours,
        },
      });
      setReason("");
      setInfo(`Grant recorded. Access expires at ${result.expiresAt}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revokeId) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await revokeSupportAccess({ data: { grantId: revokeId } });
      setRevokeId(null);
      setInfo("Grant revoked.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canAudit) {
    return (
      <section className="sherivs-console-card">
        <h1>Access Review</h1>
        <p>Access review requires the audit capability.</p>
      </section>
    );
  }

  return (
    <section className="sherivs-console-card">
      <p className="sherivs-console-page-kicker">Team & Access</p>
      <h1>Access Review</h1>
      <p>
        Privileged identities, time-limited support grants, and recent administrative events. A
        grant is not tenant membership.
      </p>
      {error ? <p className="sherivs-console-error">{error}</p> : null}
      {info ? <p>{info}</p> : null}
      {!data && !error ? <p>Loading authorized review…</p> : null}
      {data ? (
        <>
          <h2>Super admins</h2>
          {data.superAdmins.length ? (
            <div className="sherivs-console-list">
              {data.superAdmins.map((row) => (
                <div key={row.id} className="sherivs-console-row">
                  <strong>{row.full_name || row.email}</strong>
                  <small>{row.email}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">No super-admin rows are recorded.</p>
          )}
          <h2 style={{ marginTop: "1rem" }}>Active support grants</h2>
          {data.activeGrants.length ? (
            <div className="sherivs-console-list">
              {data.activeGrants.map((row) => (
                <div key={row.id} className="sherivs-console-row">
                  <strong>{row.staff_id}</strong>
                  <small>
                    Organization {row.tenant_id} · expires {row.expires_at}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </small>
                  {canGrant ? (
                    revokeId === row.id ? (
                      <ConfirmAction
                        question="Revoke this support grant now? Access ends immediately."
                        confirmLabel="Revoke grant"
                        busy={busy}
                        onConfirm={() => void revoke()}
                        onCancel={() => setRevokeId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="sherivs-console-btn secondary"
                        disabled={busy}
                        onClick={() => setRevokeId(row.id)}
                      >
                        Revoke
                      </button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">No active support grants.</p>
          )}
          {canGrant ? (
            <form
              className="sherivs-console-form"
              onSubmit={(event) => void grant(event)}
              style={{ marginTop: "1.2rem" }}
            >
              <h2>Create support grant</h2>
              <p>
                Super-admin only. Maximum duration is {SUPPORT_GRANT_MAX_HOURS} hours. Only Support
                or Platform Administration staff who are active may receive a grant, and only for an
                organization that is already provisioned.
              </p>
              <label>
                Staff
                <select
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                  required
                >
                  <option value="">Select eligible staff</option>
                  {eligibleStaff.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.full_name || row.email} ·{" "}
                      {row.roles
                        .map(
                          (role) =>
                            PLATFORM_ROLE_LABELS[role as keyof typeof PLATFORM_ROLE_LABELS] ??
                            role,
                        )
                        .join(", ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Organization
                <select
                  value={organizationKey}
                  onChange={(event) => setOrganizationKey(event.target.value)}
                  required
                >
                  <option value="">Select a provisioned organization</option>
                  {eligibleOrganizations.map((organization) => (
                    <option key={organization.id} value={organization.schoolId ?? ""}>
                      {organization.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hours
                <select
                  value={hours}
                  onChange={(event) => setHours(Number(event.target.value))}
                  required
                >
                  {GRANT_HOURS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={10}
                  maxLength={500}
                  placeholder="Why this grant is needed"
                />
              </label>
              <button
                type="submit"
                className="sherivs-console-btn"
                disabled={
                  busy ||
                  !staffId ||
                  !organizationKey ||
                  reason.trim().length < 10 ||
                  eligibleStaff.length === 0 ||
                  eligibleOrganizations.length === 0
                }
              >
                {busy ? "Recording…" : "Create grant"}
              </button>
              {eligibleStaff.length === 0 ? (
                <ConsoleNotice>
                  No active Support or Platform Administration staff are recorded.
                </ConsoleNotice>
              ) : null}
              {eligibleOrganizations.length === 0 ? (
                <ConsoleNotice>
                  No provisioned organizations are available to bind a grant.
                </ConsoleNotice>
              ) : null}
            </form>
          ) : (
            <p className="sherivs-console-empty">
              Creating or revoking grants requires the platform owner.
            </p>
          )}
          <h2 style={{ marginTop: "1rem" }}>Security alerts</h2>
          <p>
            {data.alertsAvailable
              ? `${data.alerts.length} alert${data.alerts.length === 1 ? "" : "s"} in the last 24 hours.`
              : "Alert scan is not available in this environment."}
          </p>
          <h2 style={{ marginTop: "1rem" }}>Recent administrative events</h2>
          {data.recentEvents.length ? (
            <div className="sherivs-console-list">
              {data.recentEvents.map((row) => (
                <div key={row.id} className="sherivs-console-row">
                  <strong>{row.action}</strong>
                  <small>
                    {row.created_at}
                    {row.record_id ? ` · ${row.record_id}` : ""}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="sherivs-console-empty">No recent staff or support events.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

type SupportGrantRow = Awaited<ReturnType<typeof listSupportGrants>>[number];

export function SupportTenantPanel() {
  const { overview } = useConsole();
  const [grants, setGrants] = useState<SupportGrantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof readSupportTenantSummary>
  > | null>(null);
  const canHandle = Boolean(overview?.viewer.capabilities.includes("platform.support.handle"));
  const active = grants.filter((grant) => grant.active);

  useEffect(() => {
    if (!canHandle) return;
    if (consoleVisualFixtureActive()) {
      setError("Support grants are not queried in the local visual fixture.");
      return;
    }
    void listSupportGrants()
      .then(setGrants)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Support grants could not be loaded."),
      );
  }, [canHandle]);

  async function readGrant(tenantId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await readSupportTenantSummary({ data: { schoolId: tenantId } });
      setSummary(result);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "Authorized summary could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  if (!canHandle) return null;

  return (
    <section>
      <h2>Authorized organization summary</h2>
      <p>
        Support may read a lifecycle summary only while a grant is active. This is not a product
        dashboard and does not load learner or invoice records.
      </p>
      {error ? <p className="sherivs-console-error">{error}</p> : null}
      {active.length ? (
        <div className="sherivs-console-list">
          {active.map((grant) => (
            <div key={grant.id} className="sherivs-console-row">
              <strong>Grant {grant.id}</strong>
              <small>
                Organization {grant.tenant_id} · expires {grant.expires_at}
              </small>
              <button
                type="button"
                className="sherivs-console-btn secondary"
                disabled={busy}
                onClick={() => void readGrant(grant.tenant_id)}
              >
                {busy ? "Reading…" : "Read authorized summary"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="sherivs-console-empty">
          No active support grant is recorded for you. Ask a platform owner to create a
          time-limited grant.
        </p>
      )}
      {summary?.school ? (
        <div className="sherivs-console-row" style={{ marginTop: "0.8rem" }}>
          <strong>{summary.school.name}</strong>
          <small>
            {summary.school.slug ?? "no slug"} ·{" "}
            {summary.school.is_active ? "runtime eligible" : "not eligible"} ·{" "}
            {summary.school.subscription_status ?? "subscription unknown"} · authorized members{" "}
            {summary.memberCount}
          </small>
        </div>
      ) : null}
    </section>
  );
}
