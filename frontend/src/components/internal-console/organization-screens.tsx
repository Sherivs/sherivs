import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import {
  ORGANIZATION_ASSIGNMENT_LABELS,
  ORGANIZATION_ASSIGNMENT_TYPES,
  ORGANIZATION_CONTACT_METHODS,
  ORGANIZATION_EDUCATION_LEVELS,
  ORGANIZATION_LAUNCH_WINDOWS,
  ORGANIZATION_LIFECYCLE_LABELS,
  ORGANIZATION_ONBOARDING_STEPS,
  ORGANIZATION_SCALES,
  ORGANIZATION_WORKFLOWS,
  canTransitionOrganization,
  currentOnboardingStep,
  questionnaireReady,
  type OrganizationAssignmentType,
  type OrganizationDetail,
  type OrganizationDirectoryRow,
  type OrganizationDraft,
  type OrganizationLifecycleState,
  type OrganizationOnboardingStep,
} from "@/lib/internal-console/organization-lifecycle";
import { useConsole } from "./console-shell";
import { ConfirmAction, ConsoleNotice } from "./console-primitives";
import {
  apiActivate,
  apiAssign,
  apiDeactivate,
  apiGetOrganization,
  apiListOrganizations,
  apiProvision,
  apiRelease,
  apiRestore,
  apiSaveDraft,
  apiSubmit,
  apiSuspend,
  apiTransition,
} from "./organization-api";

const STEP_LABELS: Record<OrganizationOnboardingStep, string> = {
  identity: "Organization identity",
  contact: "Primary contact",
  intended_use: "Intended use",
  configuration: "Operating requirements",
  review: "Review and confirmation",
};

function LifecycleBadge({ state }: { state: OrganizationLifecycleState }) {
  return <span className={`sherivs-console-pill is-${state}`}>{ORGANIZATION_LIFECYCLE_LABELS[state]}</span>;
}

export function ConsoleOrganizationDirectory() {
  const { overview } = useConsole();
  const search = useSearch({ strict: false }) as { state?: string };
  const searchState = typeof search.state === "string" ? search.state : "";
  const [rows, setRows] = useState<OrganizationDirectoryRow[]>(overview?.organizations ?? []);
  const [query, setQuery] = useState("");
  const [state, setState] = useState(searchState);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = overview?.viewer.capabilities.includes("platform.tenants.manage") ?? false;
  const canRead = overview?.viewer.capabilities.includes("platform.tenants.read") ?? false;

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiListOrganizations({
        query: query || undefined,
        state: (state as OrganizationLifecycleState) || undefined,
      });
      setRows(result.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organizations could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setState(searchState);
  }, [searchState]);

  useEffect(() => {
    if (canRead) void load();
    // Reload when the viewer or lifecycle filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, state]);

  if (!overview) return <section className="sherivs-console-card">Loading organizations…</section>;
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>Organizations</h1>
        <p>Organization records are limited to authorized operators.</p>
      </section>
    );
  }

  return (
    <section className="sherivs-console-card" data-testid="console-organizations">
      <p className="sherivs-console-page-kicker">Organizations</p>
      <h1>Organization directory</h1>
      <p>
        Cases are not Scholar tenants until provisioning links a schools row. Sensitive contact
        details stay on the organization profile.
      </p>
      {overview.organizationStore === "unavailable" ? (
        <ConsoleNotice tone="warning">
          Persistent organization storage is not configured in this environment. The questionnaire
          still runs in the local visual fixture.
        </ConsoleNotice>
      ) : null}
      <form
        className="sherivs-console-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        style={{ marginTop: "1rem" }}
      >
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Status
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">All recorded states</option>
            {Object.entries(ORGANIZATION_LIFECYCLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="sherivs-console-actions">
          <button type="submit" className="sherivs-console-btn secondary" disabled={busy}>
            {busy ? "Searching…" : "Filter"}
          </button>
          {canManage ? (
            <Link to={CONSOLE_PATHS.organizationNew as never} className="sherivs-console-btn">
              Onboard organization
            </Link>
          ) : null}
        </div>
      </form>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {rows.length === 0 ? (
        <p className="sherivs-console-empty">No organization cases match the current filter.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table className="sherivs-console-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Status</th>
                <th>Type</th>
                <th>Owner</th>
                <th>Runtime</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={CONSOLE_PATHS.organization(row.id) as never}>{row.displayName}</Link>
                    <div>
                      <small>
                        {[row.city, row.region, row.country].filter(Boolean).join(", ") || "Location not recorded"}
                      </small>
                    </div>
                  </td>
                  <td>
                    <LifecycleBadge state={row.lifecycleState} />
                  </td>
                  <td>{row.orgType}</td>
                  <td>{row.onboardingOwnerName ?? "Unassigned"}</td>
                  <td>{row.enabledRuntime ?? "Not enabled"}</td>
                  <td>
                    <small>{new Date(row.updatedAt).toLocaleString()}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ConsoleOrganizationOnboarding() {
  const { overview, reload } = useConsole();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OrganizationDraft>({
    orgType: "school",
    intendedRuntime: "scholar",
    expectedScale: "unspecified",
    launchTimeframe: "unspecified",
    contactMethod: "email",
    workflows: [],
    educationLevels: [],
  });
  const [id, setId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<OrganizationOnboardingStep>("identity");
  const derived = currentOnboardingStep(draft);
  const canManage = overview?.viewer.capabilities.includes("platform.tenants.manage") ?? false;

  function patch(next: Partial<OrganizationDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function persist(andSubmit = false) {
    setBusy(true);
    setError(null);
    try {
      const saved = await apiSaveDraft({ id, draft });
      setId(saved.id);
      await reload();
      if (andSubmit) {
        await apiSubmit(saved.id);
        await reload();
        await navigate({ to: CONSOLE_PATHS.organization(saved.id) as never });
        return;
      }
      const order = ORGANIZATION_ONBOARDING_STEPS;
      const index = order.indexOf(step);
      const next = order[index + 1];
      if (next) setStep(next);
      else setStep(derived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The questionnaire could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!overview) return <section className="sherivs-console-card">Loading questionnaire…</section>;
  if (!canManage) {
    return (
      <section className="sherivs-console-card">
        <h1>Onboard organization</h1>
        <p>Only authorized operations staff can start organization onboarding.</p>
      </section>
    );
  }

  return (
    <section className="sherivs-console-card" data-testid="console-organization-onboard">
      <p className="sherivs-console-page-kicker">Organizations</p>
      <h1>Onboard organization</h1>
      <p>
        Collect only the information required to review and provision a Scholar tenant. Academic
        configuration stays inside Sherivs Scholar after activation.
      </p>
      <ol className="sherivs-console-steps">
        {ORGANIZATION_ONBOARDING_STEPS.map((item) => (
          <li key={item} className={item === step ? "is-current" : undefined}>
            {STEP_LABELS[item]}
          </li>
        ))}
      </ol>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      <form
        className="sherivs-console-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void persist(step === "review");
        }}
      >
        {step === "identity" ? (
          <>
            <label>
              Display name
              <input
                value={draft.displayName ?? ""}
                onChange={(event) => patch({ displayName: event.target.value })}
                required
                minLength={2}
              />
            </label>
            <label>
              Legal name, if applicable
              <input
                value={draft.legalName ?? ""}
                onChange={(event) => patch({ legalName: event.target.value || undefined })}
              />
            </label>
            <label>
              Organization type
              <select value={draft.orgType ?? "school"} disabled>
                <option value="school">School / educational institution</option>
              </select>
            </label>
            <label>
              Country
              <input
                value={draft.country ?? ""}
                onChange={(event) => patch({ country: event.target.value })}
                required
                minLength={2}
              />
            </label>
            <label>
              State or region
              <input
                value={draft.region ?? ""}
                onChange={(event) => patch({ region: event.target.value || undefined })}
              />
            </label>
            <label>
              City
              <input
                value={draft.city ?? ""}
                onChange={(event) => patch({ city: event.target.value || undefined })}
              />
            </label>
            <label>
              Official email, if different from the contact
              <input
                type="email"
                value={draft.officialEmail ?? ""}
                onChange={(event) => patch({ officialEmail: event.target.value || undefined })}
              />
            </label>
          </>
        ) : null}
        {step === "contact" ? (
          <>
            <label>
              Contact name
              <input
                value={draft.contactName ?? ""}
                onChange={(event) => patch({ contactName: event.target.value })}
                required
                minLength={2}
              />
            </label>
            <label>
              Official email
              <input
                type="email"
                value={draft.contactEmail ?? ""}
                onChange={(event) => patch({ contactEmail: event.target.value })}
                required
              />
            </label>
            <label>
              Phone
              <input
                value={draft.contactPhone ?? ""}
                onChange={(event) => patch({ contactPhone: event.target.value || undefined })}
              />
            </label>
            <label>
              Job title or relationship
              <input
                value={draft.contactTitle ?? ""}
                onChange={(event) => patch({ contactTitle: event.target.value || undefined })}
              />
            </label>
            <label>
              Preferred communication
              <select
                value={draft.contactMethod ?? "email"}
                onChange={(event) =>
                  patch({ contactMethod: event.target.value as typeof ORGANIZATION_CONTACT_METHODS[number] })
                }
              >
                {ORGANIZATION_CONTACT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {step === "intended_use" ? (
          <>
            <label>
              Required service
              <select value="scholar" disabled>
                <option value="scholar">Sherivs Scholar</option>
              </select>
            </label>
            <label>
              Expected scale
              <select
                value={draft.expectedScale ?? "unspecified"}
                onChange={(event) =>
                  patch({ expectedScale: event.target.value as typeof ORGANIZATION_SCALES[number] })
                }
              >
                {ORGANIZATION_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Workflows needed at launch</legend>
              {ORGANIZATION_WORKFLOWS.map((workflow) => (
                <label key={workflow} className="sherivs-console-check">
                  <input
                    type="checkbox"
                    checked={(draft.workflows ?? []).includes(workflow)}
                    onChange={(event) => {
                      const current = new Set(draft.workflows ?? []);
                      if (event.target.checked) current.add(workflow);
                      else current.delete(workflow);
                      patch({ workflows: [...current] });
                    }}
                  />
                  {workflow}
                </label>
              ))}
            </fieldset>
            <label>
              Expected launch timeframe
              <select
                value={draft.launchTimeframe ?? "unspecified"}
                onChange={(event) =>
                  patch({
                    launchTimeframe: event.target.value as typeof ORGANIZATION_LAUNCH_WINDOWS[number],
                  })
                }
              >
                {ORGANIZATION_LAUNCH_WINDOWS.map((window) => (
                  <option key={window} value={window}>
                    {window.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {step === "configuration" ? (
          <>
            <label>
              School structure notes
              <textarea
                value={draft.schoolStructure ?? ""}
                onChange={(event) => patch({ schoolStructure: event.target.value || undefined })}
                rows={3}
              />
            </label>
            <label>
              Academic calendar preferences
              <textarea
                value={draft.academicCalendar ?? ""}
                onChange={(event) => patch({ academicCalendar: event.target.value || undefined })}
                rows={3}
              />
            </label>
            <fieldset>
              <legend>Relevant education levels</legend>
              {ORGANIZATION_EDUCATION_LEVELS.map((level) => (
                <label key={level} className="sherivs-console-check">
                  <input
                    type="checkbox"
                    checked={(draft.educationLevels ?? []).includes(level)}
                    onChange={(event) => {
                      const current = new Set(draft.educationLevels ?? []);
                      if (event.target.checked) current.add(level);
                      else current.delete(level);
                      patch({ educationLevels: [...current] });
                    }}
                  />
                  {level.replace("_", " ")}
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {step === "review" ? (
          <div className="sherivs-console-list">
            <div className="sherivs-console-row">
              <strong>{draft.displayName}</strong>
              <small>
                {draft.orgType} · {[draft.city, draft.region, draft.country].filter(Boolean).join(", ")}
              </small>
            </div>
            <div className="sherivs-console-row">
              <strong>Primary contact</strong>
              <small>
                {draft.contactName} · {draft.contactEmail} · {draft.contactMethod}
              </small>
            </div>
            <div className="sherivs-console-row">
              <strong>Intended service</strong>
              <small>
                Sherivs Scholar · {draft.expectedScale} · {draft.launchTimeframe}
              </small>
            </div>
          </div>
        ) : null}
        <div className="sherivs-console-actions">
          <button type="submit" className="sherivs-console-btn" disabled={busy}>
            {busy ? "Saving…" : step === "review" ? "Submit for review" : "Save and continue"}
          </button>
          {step === "review" && !questionnaireReady(draft) ? (
            <p className="sherivs-console-empty">Complete the earlier steps before submitting.</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

export function ConsoleOrganizationProfile() {
  const params = useParams({ strict: false }) as { organizationId?: string };
  const { overview, reload } = useConsole();
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [assignmentType, setAssignmentType] = useState<OrganizationAssignmentType>("onboarding_owner");
  const [staffId, setStaffId] = useState(overview?.viewer.id ?? "");
  const canManage = overview?.viewer.capabilities.includes("platform.tenants.manage") ?? false;

  async function load() {
    if (!params.organizationId) return;
    try {
      setDetail(await apiGetOrganization(params.organizationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization could not be loaded.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.organizationId]);

  const actions = useMemo(() => {
    if (!detail) return [];
    const state = detail.lifecycleState;
    const items: Array<{ key: string; label: string; run: () => Promise<unknown> }> = [];
    if (canTransitionOrganization(state, "under_review")) {
      items.push({
        key: "review",
        label: "Start review",
        run: () => apiTransition(detail.id, "under_review"),
      });
    }
    if (canTransitionOrganization(state, "submitted") && state === "under_review") {
      items.push({
        key: "changes",
        label: "Return for changes",
        run: () => apiTransition(detail.id, "submitted", "returned"),
      });
    }
    if (canTransitionOrganization(state, "provisioning") || state === "provisioning_failed") {
      items.push({ key: "provision", label: "Provision", run: () => apiProvision(detail.id) });
    }
    if (canTransitionOrganization(state, "active") && state === "ready_for_activation") {
      items.push({ key: "activate", label: "Activate", run: () => apiActivate(detail.id) });
    }
    if (canTransitionOrganization(state, "suspended")) {
      items.push({ key: "suspend", label: "Suspend", run: () => apiSuspend(detail.id) });
    }
    if (canTransitionOrganization(state, "active") && state === "suspended") {
      items.push({ key: "restore", label: "Restore", run: () => apiRestore(detail.id) });
    }
    if (canTransitionOrganization(state, "deactivated")) {
      items.push({ key: "deactivate", label: "Deactivate", run: () => apiDeactivate(detail.id) });
    }
    return items;
  }, [detail]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      setPending(null);
      await load();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The operation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!overview) return <section className="sherivs-console-card">Loading organization…</section>;
  if (!detail) {
    return (
      <section className="sherivs-console-card">
        <h1>Organization</h1>
        {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : <p>Loading organization…</p>}
      </section>
    );
  }

  return (
    <section className="sherivs-console-card" data-testid="console-organization-profile">
      <p className="sherivs-console-page-kicker">Organizations</p>
      <h1>{detail.displayName}</h1>
      <p>
        <LifecycleBadge state={detail.lifecycleState} /> · {detail.orgType} ·{" "}
        {detail.enabledRuntime ?? "runtime not enabled"}
      </p>
      {detail.provisioningError ? (
        <ConsoleNotice tone="error">{detail.provisioningError}</ConsoleNotice>
      ) : null}
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      <div className="sherivs-console-list" style={{ marginTop: "1rem" }}>
        <div className="sherivs-console-row">
          <strong>Tenant link</strong>
          <small>
            {detail.schoolId
              ? `Linked school ${detail.schoolId}`
              : "Not provisioned. No public.schools row exists yet."}
          </small>
        </div>
        <div className="sherivs-console-row">
          <strong>Location</strong>
          <small>{[detail.city, detail.region, detail.country].filter(Boolean).join(", ") || "Not recorded"}</small>
        </div>
        {detail.contact ? (
          <div className="sherivs-console-row">
            <strong>Primary contact</strong>
            <small>
              {detail.contact.name} · {detail.contact.email} · {detail.contact.method}
            </small>
          </div>
        ) : (
          <div className="sherivs-console-row">
            <strong>Primary contact</strong>
            <small>Contact details are limited to assigned staff and organization administrators.</small>
          </div>
        )}
        <div className="sherivs-console-row">
          <strong>Outstanding requirements</strong>
          <small>
            {detail.outstandingRequirements.length
              ? detail.outstandingRequirements.join(", ")
              : "None recorded"}
          </small>
        </div>
      </div>

      {detail.accessEffects ? (
        <div className="sherivs-console-card" style={{ marginTop: "1rem" }}>
          <h2>Access effects</h2>
          <p>{detail.accessEffects.sessions}</p>
          <p>{detail.accessEffects.api}</p>
          <p>{detail.accessEffects.runtime}</p>
          <p>{detail.accessEffects.data}</p>
          <p>{detail.accessEffects.audit}</p>
        </div>
      ) : null}

      {canManage ? (
        <div className="sherivs-console-actions" style={{ marginTop: "1rem" }}>
          {actions.map((action) =>
            pending === action.key ? (
              <ConfirmAction
                key={action.key}
                question={`${action.label} ${detail.displayName}?`}
                confirmLabel={action.label}
                busy={busy === action.key}
                onConfirm={() => void run(action.key, action.run)}
                onCancel={() => setPending(null)}
              />
            ) : (
              <button
                key={action.key}
                type="button"
                className="sherivs-console-btn secondary"
                onClick={() => setPending(action.key)}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}

      <h2 style={{ marginTop: "1.5rem" }}>Assignments</h2>
      {detail.assignments.length ? (
        <div className="sherivs-console-list">
          {detail.assignments.map((assignment) => (
            <div key={assignment.id} className="sherivs-console-row">
              <strong>{assignment.staffName ?? assignment.staffId}</strong>
              <small>
                {ORGANIZATION_ASSIGNMENT_LABELS[assignment.assignmentType]} · {assignment.status} ·{" "}
                {new Date(assignment.assignedAt).toLocaleString()}
              </small>
              {canManage && assignment.status === "active" ? (
                <button
                  type="button"
                  className="sherivs-console-btn secondary"
                  onClick={() => void run(`release-${assignment.id}`, () => apiRelease(assignment.id))}
                >
                  Release
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="sherivs-console-empty">No staff are assigned. Releasing an assignee keeps history.</p>
      )}
      {canManage ? (
        <form
          className="sherivs-console-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run("assign", () =>
              apiAssign({
                organizationId: detail.id,
                staffId,
                assignmentType,
              }),
            );
          }}
        >
          <label>
            Staff member
            <select value={staffId} onChange={(event) => setStaffId(event.target.value)} required>
              <option value={overview.viewer.id}>{overview.viewer.name} (you)</option>
              {overview.staff
                .filter((row) => row.status === "active")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.fullName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Assignment type
            <select
              value={assignmentType}
              onChange={(event) =>
                setAssignmentType(event.target.value as OrganizationAssignmentType)
              }
            >
              {ORGANIZATION_ASSIGNMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ORGANIZATION_ASSIGNMENT_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="sherivs-console-btn" disabled={busy === "assign"}>
            Assign
          </button>
        </form>
      ) : null}

      <h2 style={{ marginTop: "1.5rem" }}>Lifecycle history</h2>
      {detail.transitions.length ? (
        <div className="sherivs-console-list">
          {detail.transitions.map((item) => (
            <div key={item.id} className="sherivs-console-row">
              <strong>
                {item.fromState ?? "none"} → {ORGANIZATION_LIFECYCLE_LABELS[item.toState]}
              </strong>
              <small>
                {item.reason ?? "recorded"} · {new Date(item.at).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="sherivs-console-empty">No transitions recorded yet.</p>
      )}
    </section>
  );
}
