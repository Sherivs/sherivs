/**
 * Custom role and responsibility builder (mission M4, ADR-116), in the shell, admin only.
 * Steps follow master brief §7.3: base template or scratch, responsibilities then permissions
 * (protected ones flagged and not selectable), scope ceiling, workspace (three navigation sections
 * and widgets), SoD and risk preview, "simulate as", submit, second-admin approval, activation,
 * version history. The database enforces every rule; this screen explains them first.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATALOG } from "@/lib/sherivs-ws/engine";
import { APP_SHELL_HOME, appShellSectionPath } from "@/lib/shell/paths";
import { WORKSPACE_CATEGORIES } from "@/lib/workspaces/contract";
import {
  SCOPE_CEILINGS,
  draftInputSchema,
  responsibilityInputSchema,
  type BuilderCatalogue,
  type CustomRoleDraftInput,
  type RiskPreview,
  type SimulationResult,
} from "@/lib/role-builder/role-builder-core";
import type { AuditEntry, CustomRoleVersion } from "@/lib/role-builder/role-builder-port";
import {
  activateCustomRole,
  approveCustomRole,
  customRoleHistory,
  defineCustomResponsibility,
  loadRoleBuilder,
  previewCustomRole,
  saveCustomRoleDraft,
  simulateCustomRole,
  submitCustomRole,
  withdrawCustomRole,
} from "@/lib/role-builder/role-builder.functions";
import { ErrorAlert, FieldShell, StatusBadge, TARGET, inputClass } from "./role-builder-ui";

const CATEGORY_LABEL: Record<string, string> = {
  institutional_executive: "Institutional executive",
  academic_teaching: "Academic and teaching",
  administrative_operations: "Administrative and operations",
  student_family: "Learners and families",
  government_oversight: "Government oversight",
};
const WIDGETS = CATALOG.filter((item) => item.kind === "widget").map((item) => ({
  key: item.key,
  label: item.label.en,
}));

type Draft = CustomRoleDraftInput;
const EMPTY_DRAFT: Draft = {
  slug: "",
  name: "",
  baseTemplate: null,
  permissions: [],
  responsibilities: [],
  scopeCeiling: "org",
  workspaceCategory: "administrative_operations",
  layout: {
    nav: [
      { id: "", label: "" },
      { id: "", label: "" },
      { id: "", label: "" },
    ],
    widgets: [],
  },
};

function fieldErrors(draft: Draft): Record<string, string> {
  const result = draftInputSchema.safeParse(draft);
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.slice(0, 3).join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function draftFromVersion(version: CustomRoleVersion): Draft {
  const nav = [...version.layout.nav];
  while (nav.length < 3) nav.push({ id: "", label: "" });
  return {
    slug: version.code.slice("custom.".length),
    name: version.name,
    baseTemplate: version.baseTemplate,
    permissions: version.permissions,
    responsibilities: version.responsibilities,
    scopeCeiling: version.scopeCeiling,
    workspaceCategory: (WORKSPACE_CATEGORIES as readonly string[]).includes(
      version.workspaceCategory,
    )
      ? (version.workspaceCategory as Draft["workspaceCategory"])
      : "administrative_operations",
    layout: { nav, widgets: version.layout.widgets },
  };
}

export interface CustomRoleBuilderInitial {
  catalogue: BuilderCatalogue;
  versions: CustomRoleVersion[];
  me: string;
  draft?: Draft;
  preview?: RiskPreview;
  simulation?: SimulationResult;
}

/** `initial` seeds the screen (server render, tests); the shell opens it without props. */
export function CustomRoleBuilderScreen({ initial }: { initial?: CustomRoleBuilderInitial } = {}) {
  const [catalogue, setCatalogue] = useState<BuilderCatalogue | null>(initial?.catalogue ?? null);
  const [versions, setVersions] = useState<CustomRoleVersion[]>(initial?.versions ?? []);
  const [me, setMe] = useState(initial?.me ?? "");
  const [draft, setDraft] = useState<Draft>(initial?.draft ?? EMPTY_DRAFT);
  const [touched, setTouched] = useState(Boolean(initial?.draft));
  const [preview, setPreview] = useState<RiskPreview | null>(initial?.preview ?? null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(
    initial?.simulation ?? null,
  );
  const [history, setHistory] = useState<{ code: string; audit: AuditEntry[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);

  const reload = useCallback(async () => {
    try {
      const result = await loadRoleBuilder();
      setCatalogue(result.catalogue);
      setVersions(result.versions);
      setMe(result.me);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  const template = catalogue?.templates.find((t) => t.code === draft.baseTemplate) ?? null;
  const permissionByCode = useMemo(
    () => new Map((catalogue?.permissions ?? []).map((p) => [p.code, p])),
    [catalogue],
  );
  const selectable = useMemo(() => {
    const codes = new Set([
      ...(catalogue?.allowedPermissions ?? []),
      ...(template ? [...template.mandatory, ...template.optional] : []),
      // Protected permissions are listed (flagged, not selectable) so the admin sees what only
      // a catalogue role can carry.
      ...(catalogue?.permissions ?? []).filter((p) => p.protected).map((p) => p.code),
    ]);
    return [...codes]
      .map((code) => permissionByCode.get(code))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .sort((a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code));
  }, [catalogue, template, permissionByCode]);
  const errors = touched ? fieldErrors(draft) : {};

  async function run<T>(label: string, action: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const value = await action();
      after?.(value);
      setNotice(label);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setSimulation(null);
  }
  function togglePermission(code: string) {
    update({
      permissions: draft.permissions.includes(code)
        ? draft.permissions.filter((c) => c !== code)
        : [...draft.permissions, code],
    });
  }
  function toggleResponsibility(code: string) {
    const responsibility = catalogue?.responsibilities.find((r) => r.code === code);
    const on = !draft.responsibilities.includes(code);
    update({
      responsibilities: on
        ? [...draft.responsibilities, code]
        : draft.responsibilities.filter((c) => c !== code),
      permissions: on
        ? [...new Set([...draft.permissions, ...(responsibility?.permissions ?? [])])].filter(
            (p) => !permissionByCode.get(p)?.protected,
          )
        : draft.permissions,
    });
  }
  function setNav(index: number, patch: Partial<{ id: string; label: string }>) {
    const nav = draft.layout.nav.map((section, i) =>
      i === index ? { ...section, ...patch } : section,
    );
    update({ layout: { ...draft.layout, nav } });
  }
  function chooseTemplate(code: string) {
    const next = catalogue?.templates.find((t) => t.code === code) ?? null;
    update({
      baseTemplate: next?.code ?? null,
      scopeCeiling: next?.scope ?? draft.scopeCeiling,
      permissions: next ? [...new Set([...next.mandatory, ...draft.permissions])] : draft.permissions,
      layout: next?.nav.length
        ? {
            ...draft.layout,
            nav: [0, 1, 2].map((i) => {
              const label = next.nav[i] ?? draft.layout.nav[i]?.label ?? "";
              return {
                id: label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_")
                  .replace(/^_+|_+$/g, ""),
                label,
              };
            }),
          }
        : draft.layout,
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(fieldErrors(draft)).length) return;
    await run("Draft saved and audited.", () => saveCustomRoleDraft({ data: draft }), (r) => {
      setPreview(r.preview);
      void reload();
    });
  }

  if (loading) return <p role="status">Loading the role builder…</p>;
  if (!catalogue)
    return (
      <section className="app-shell-section" data-testid="custom-role-builder">
        <h1>Custom roles</h1>
        <ErrorAlert error={error} />
      </section>
    );

  const codes = [...new Set(versions.map((v) => v.code))];
  return (
    <section className="app-shell-section" data-testid="custom-role-builder">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <nav aria-label="Role tools" className="flex flex-wrap gap-4 text-sm">
        <Link className={TARGET} to={appShellSectionPath("roles") as never}>
          Roles and assignments
        </Link>
        <Link className={TARGET} to={appShellSectionPath("access-reviews") as never}>
          Access reviews
        </Link>
        <Link className={TARGET} to={appShellSectionPath("delegations") as never}>
          Delegations
        </Link>
      </nav>
      <h1>Custom roles</h1>
      <p className="text-sm text-muted-foreground">
        A custom role is approved by a second administrator before anyone can hold it. Protected
        permissions only come from catalogue roles.
        {catalogue.institutionType ? ` Institution type: ${catalogue.institutionType}.` : ""}
      </p>
      <ErrorAlert error={error} />
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Build a role</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => void onSave(e)} noValidate>
            <FieldShell
              label="Role code"
              hint="Lower-case letters, digits, _ . or -. Saved as custom.<code>."
              error={errors.slug}
            >
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={draft.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                />
              )}
            </FieldShell>
            <FieldShell label="Role name" error={errors.name}>
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              )}
            </FieldShell>
            <FieldShell
              label="1. Base template"
              hint="A role started from scratch can be approved but not assigned until it has a base template."
            >
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={draft.baseTemplate ?? ""}
                  onChange={(e) => chooseTemplate(e.target.value)}
                >
                  <option value="">Start from scratch</option>
                  {catalogue.templates.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} ({t.scope})
                    </option>
                  ))}
                </select>
              )}
            </FieldShell>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">2. Responsibilities</legend>
              {catalogue.responsibilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No responsibilities yet. Define one below; it then appears here.
                </p>
              ) : (
                catalogue.responsibilities.map((r) => (
                  <label key={r.id} className={`flex items-center gap-2 ${TARGET}`}>
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={draft.responsibilities.includes(r.code)}
                      onChange={() => toggleResponsibility(r.code)}
                    />
                    {r.label} <span className="text-xs text-muted-foreground">({r.kind})</span>
                  </label>
                ))
              )}
            </fieldset>

            <fieldset className="grid gap-1" aria-describedby="perm-hint">
              <legend className="text-sm font-medium">Permissions</legend>
              <p id="perm-hint" className="text-xs text-muted-foreground">
                Mandatory permissions of the base template are always held. Protected permissions
                are shown for information and cannot be selected.
              </p>
              {errors.permissions ? (
                <p className="text-sm text-destructive">Error: {errors.permissions}</p>
              ) : null}
              <div className="grid gap-1 sm:grid-cols-2">
                {selectable.map((p) => {
                  const mandatory = template?.mandatory.includes(p.code) ?? false;
                  return (
                    <label
                      key={p.code}
                      className={`flex items-center gap-2 text-sm ${TARGET}`}
                      data-protected={p.protected || undefined}
                    >
                      <input
                        type="checkbox"
                        className="size-5"
                        disabled={p.protected || mandatory}
                        checked={mandatory || draft.permissions.includes(p.code)}
                        onChange={() => togglePermission(p.code)}
                      />
                      <span>
                        {p.label} <code className="text-xs">{p.code}</code>
                        {p.protected ? " (protected)" : ""}
                        {mandatory ? " (mandatory)" : ""}
                        {p.sensitivity === "restricted" || p.sensitivity === "confidential"
                          ? ` · ${p.sensitivity}`
                          : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <FieldShell label="3. Scope ceiling" error={errors.scopeCeiling}>
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={draft.scopeCeiling}
                  onChange={(e) => update({ scopeCeiling: e.target.value as Draft["scopeCeiling"] })}
                >
                  {SCOPE_CEILINGS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </FieldShell>
            <FieldShell label="Workspace category">
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={draft.workspaceCategory}
                  onChange={(e) =>
                    update({ workspaceCategory: e.target.value as Draft["workspaceCategory"] })
                  }
                >
                  {WORKSPACE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c] ?? c}
                    </option>
                  ))}
                </select>
              )}
            </FieldShell>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium">
                4. Workspace: exactly three navigation sections
              </legend>
              {errors["layout.nav"] ? (
                <p className="text-sm text-destructive">Error: {errors["layout.nav"]}</p>
              ) : null}
              {draft.layout.nav.map((section, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-2">
                  <FieldShell
                    label={`Section ${index + 1} label`}
                    error={errors[`layout.nav.${index}`]}
                  >
                    {(p) => (
                      <input
                        {...p}
                        className={inputClass}
                        value={section.label}
                        onChange={(e) => setNav(index, { label: e.target.value })}
                      />
                    )}
                  </FieldShell>
                  <FieldShell label={`Section ${index + 1} id`} hint="For example collections">
                    {(p) => (
                      <input
                        {...p}
                        className={inputClass}
                        value={section.id}
                        onChange={(e) => setNav(index, { id: e.target.value })}
                      />
                    )}
                  </FieldShell>
                </div>
              ))}
              <FieldShell label="Widgets" hint="Hold Ctrl or Cmd to pick up to twelve.">
                {(p) => (
                  <select
                    {...p}
                    multiple
                    className={`${inputClass} h-40`}
                    value={draft.layout.widgets}
                    onChange={(e) =>
                      update({
                        layout: {
                          ...draft.layout,
                          widgets: [...e.target.selectedOptions].map((o) => o.value).slice(0, 12),
                        },
                      })
                    }
                  >
                    {WIDGETS.map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                )}
              </FieldShell>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={TARGET}
                disabled={busy}
                onClick={() => {
                  setTouched(true);
                  void run("Preview ready.", () => previewCustomRole({ data: draft }), setPreview);
                }}
              >
                5. Check separation of duties and risk
              </Button>
              <Button
                type="button"
                variant="outline"
                className={TARGET}
                disabled={busy}
                onClick={() => {
                  setTouched(true);
                  void run("Simulation ready.", () => simulateCustomRole({ data: draft }), setSimulation);
                }}
              >
                6. Simulate as a holder
              </Button>
              <Button type="submit" className={TARGET} disabled={busy}>
                Save draft
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview ? <PreviewCard preview={preview} /> : null}
      {simulation ? <SimulationCard simulation={simulation} /> : null}

      <Card data-testid="custom-role-versions">
        <CardHeader>
          <CardTitle>7–8. Approval, activation and versions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom roles yet. Build one above and save it as a draft.
            </p>
          ) : null}
          {codes.map((code) => (
            <div key={code} className="grid gap-2 border-b pb-3">
              <h2 className="text-base font-semibold">{code}</h2>
              {versions
                .filter((v) => v.code === code)
                .map((v) => (
                  <VersionRow
                    key={v.id}
                    version={v}
                    me={me}
                    busy={busy}
                    onEdit={() => setDraft(draftFromVersion(v))}
                    onAction={(label, fn) => void run(label, fn, () => void reload())}
                  />
                ))}
              <Button
                type="button"
                variant="ghost"
                className={`${TARGET} justify-self-start`}
                onClick={() =>
                  void run("History loaded.", () => customRoleHistory({ data: { code } }), (r) =>
                    setHistory({ code, audit: r.audit }),
                  )
                }
              >
                Show audit history
              </Button>
              {history?.code === code ? (
                <ul className="grid gap-1 text-xs" aria-label={`Audit history of ${code}`}>
                  {history.audit.map((entry, i) => (
                    <li key={i}>
                      {entry.at} · {entry.action} · {entry.actor === me ? "you" : (entry.actor ?? "system")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <ResponsibilityBuilder
        catalogue={catalogue}
        busy={busy}
        onSave={(input) =>
          void run("Responsibility saved and audited.", () =>
            defineCustomResponsibility({ data: input }),
          ).then(() => reload())
        }
      />
    </section>
  );
}

function VersionRow({
  version,
  me,
  busy,
  onEdit,
  onAction,
}: {
  version: CustomRoleVersion;
  me: string;
  busy: boolean;
  onEdit: () => void;
  onAction: (label: string, fn: () => Promise<unknown>) => void;
}) {
  const mine = version.createdBy === me;
  const id = version.id;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-version={version.version}>
      <span>
        v{version.version} · {version.name}
      </span>
      <StatusBadge status={version.status} />
      <span className="text-xs text-muted-foreground">
        {version.layout.nav.map((n) => n.label).join(" / ")}
      </span>
      {version.status === "draft" ? (
        <>
          <Button type="button" variant="outline" className={TARGET} onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            className={TARGET}
            disabled={busy}
            onClick={() => onAction("Submitted for approval.", () => submitCustomRole({ data: { id } }))}
          >
            Submit for approval
          </Button>
        </>
      ) : null}
      {version.status === "pending_approval" ? (
        <>
          <Button
            type="button"
            variant="outline"
            className={TARGET}
            disabled={busy}
            onClick={() => onAction("Withdrawn to draft.", () => withdrawCustomRole({ data: { id } }))}
          >
            Withdraw
          </Button>
          <Button
            type="button"
            className={TARGET}
            disabled={busy || mine}
            aria-describedby={mine ? `four-eyes-${id}` : undefined}
            onClick={() => onAction("Approved.", () => approveCustomRole({ data: { id } }))}
          >
            Approve
          </Button>
          {mine ? (
            <span id={`four-eyes-${id}`} className="text-xs">
              You created this version, so another administrator must approve it.
            </span>
          ) : null}
        </>
      ) : null}
      {version.status === "active" ? (
        <>
          <Button
            type="button"
            className={TARGET}
            disabled={busy || !version.baseTemplate}
            aria-describedby={!version.baseTemplate ? `scratch-${id}` : undefined}
            onClick={() =>
              onAction("Activated: the role can now be assigned.", () =>
                activateCustomRole({ data: { id } }),
              )
            }
          >
            Activate for assignment
          </Button>
          <Button type="button" variant="outline" className={TARGET} onClick={onEdit}>
            Start a new version
          </Button>
          {!version.baseTemplate ? (
            <span id={`scratch-${id}`} className="text-xs">
              Started from scratch: choose a base template in a new version to make it assignable.
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PreviewCard({ preview }: { preview: RiskPreview }) {
  return (
    <Card data-testid="sod-preview">
      <CardHeader>
        <CardTitle>Separation of duties and risk</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p>
          <StatusBadge status={preview.blocked ? "blocked" : "completed"} />{" "}
          {preview.blocked ? "This draft cannot be saved yet." : "No blocking problem."} Risk:{" "}
          <strong>{preview.level}</strong>.
        </p>
        <ul className="grid gap-1 pl-5" aria-label="Findings">
          {preview.reasons.map((reason, i) => (
            <li key={i} className="list-disc">
              {reason}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SimulationCard({ simulation }: { simulation: SimulationResult }) {
  return (
    <Card data-testid="simulate-as">
      <CardHeader>
        <CardTitle>Simulate as a holder</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p className="text-muted-foreground">{simulation.note}</p>
        {simulation.manifest ? (
          <>
            <p>Primary navigation</p>
            <ol className="grid gap-1 pl-5" data-testid="simulated-nav">
              {simulation.primaryNav.map((s) => (
                <li key={s.id} className="list-decimal">
                  {s.label}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>No workspace: a holder needs exactly three navigation sections.</p>
        )}
        <p>Widgets</p>
        <ul className="grid gap-1 pl-5">
          {simulation.widgets.map((w) => (
            <li key={w.key} className="list-disc">
              {w.label}: {w.shown ? "shown" : `hidden (${w.reason})`}
            </li>
          ))}
          {simulation.widgets.length === 0 ? <li>No widgets chosen.</li> : null}
        </ul>
      </CardContent>
    </Card>
  );
}

function ResponsibilityBuilder({
  catalogue,
  busy,
  onSave,
}: {
  catalogue: BuilderCatalogue;
  busy: boolean;
  onSave: (input: unknown) => void;
}) {
  const [form, setForm] = useState({
    code: "",
    label: "",
    description: "",
    permissions: [] as string[],
    evidence: "",
    cadence: "90",
    navId: "",
    navLabel: "",
  });
  const [touched, setTouched] = useState(false);
  const input = {
    code: form.code,
    label: form.label,
    description: form.description,
    permissions: form.permissions,
    evidenceRequired: form.evidence
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    reviewCadenceDays: form.cadence ? Number(form.cadence) : null,
    dailyPriority: 100,
    navSection: { id: form.navId, label: form.navLabel },
  };
  const parsed = responsibilityInputSchema.safeParse(input);
  const errors: Record<string, string> = {};
  if (touched && !parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (!errors[key]) errors[key] = issue.message;
    }
  const permissions = catalogue.permissions.filter((p) => !p.protected);
  return (
    <Card data-testid="responsibility-builder">
      <CardHeader>
        <CardTitle>Custom responsibility</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (parsed.success) onSave(input);
          }}
        >
          <FieldShell label="Code" error={errors.code}>
            {(p) => (
              <input {...p} className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            )}
          </FieldShell>
          <FieldShell label="Name" error={errors.label}>
            {(p) => (
              <input {...p} className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            )}
          </FieldShell>
          <FieldShell label="Description" error={errors.description}>
            {(p) => (
              <textarea {...p} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            )}
          </FieldShell>
          <FieldShell label="Permissions (non-protected only)" hint="Ctrl or Cmd to pick several." error={errors.permissions}>
            {(p) => (
              <select
                {...p}
                multiple
                className={`${inputClass} h-40`}
                value={form.permissions}
                onChange={(e) => setForm({ ...form, permissions: [...e.target.selectedOptions].map((o) => o.value) })}
              >
                {permissions.map((perm) => (
                  <option key={perm.code} value={perm.code}>
                    {perm.label} ({perm.code})
                  </option>
                ))}
              </select>
            )}
          </FieldShell>
          <FieldShell label="Evidence required" hint="One item per line, for example: Duty rota signed by the head." error={errors.evidenceRequired}>
            {(p) => (
              <textarea {...p} className={inputClass} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
            )}
          </FieldShell>
          <FieldShell label="Review cadence (days)" hint="Between 7 and 730." error={errors.reviewCadenceDays}>
            {(p) => (
              <input {...p} type="number" min={7} max={730} className={inputClass} value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} />
            )}
          </FieldShell>
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldShell label="Navigation section label" error={errors.navSection}>
              {(p) => (
                <input {...p} className={inputClass} value={form.navLabel} onChange={(e) => setForm({ ...form, navLabel: e.target.value })} />
              )}
            </FieldShell>
            <FieldShell label="Navigation section id">
              {(p) => (
                <input {...p} className={inputClass} value={form.navId} onChange={(e) => setForm({ ...form, navId: e.target.value })} />
              )}
            </FieldShell>
          </div>
          <Button type="submit" className={`${TARGET} justify-self-start`} disabled={busy}>
            Save responsibility
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
