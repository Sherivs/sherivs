/**
 * Role overrides (M2c, ADR-161), in the shell, administrators only.
 * An organization may narrow a role template or add or remove an optional permission; it can never touch a guardrail or a
 * separation-of-duties rule. A proposal has no effect until a second administrator approves it (four-eyes). Ending an override
 * keeps it as history. The database enforces every rule; this screen explains them first.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_SHELL_HOME, appShellSectionPath } from "@/lib/shell/paths";
import {
  NARROWING_SCOPES,
  OVERRIDE_KINDS,
  describeOverride,
  overrideInputSchema,
  type OverrideKind,
  type OverridesView,
} from "@/lib/role-builder/role-overrides";
import {
  approveRoleOverride,
  endRoleOverride,
  listRoleOverrides,
  proposeRoleOverride,
} from "@/lib/role-builder/role-overrides.functions";
import { ErrorAlert, FieldShell, StatusBadge, TARGET, inputClass } from "./role-builder-ui";

const KIND_LABEL: Record<OverrideKind, string> = {
  rename: "Rename the role",
  enable: "Turn the role back on",
  disable: "Turn the role off",
  add_optional_permission: "Add an optional permission",
  remove_optional_permission: "Remove an optional permission",
  scope_narrow: "Narrow the scope",
  approval_limit: "Lower the approval limit",
  add_responsibility: "Add a responsibility",
};

/** The one field a kind needs, as a payload key. Kinds with no key (enable) show none. */
const FIELD: Partial<Record<OverrideKind, { key: string; label: string; hint?: string }>> = {
  rename: { key: "name", label: "New name", hint: "2 to 120 characters." },
  disable: { key: "reason", label: "Reason (optional)" },
  add_optional_permission: {
    key: "permission",
    label: "Permission code",
    hint: "Only an optional permission of the role. A protected permission is always refused.",
  },
  remove_optional_permission: {
    key: "permission",
    label: "Permission code",
    hint: "A mandatory permission can never be removed.",
  },
  approval_limit: {
    key: "limit_ngn",
    label: "New limit (₦)",
    hint: "It can only be lowered, never raised above the role's own ceiling.",
  },
  add_responsibility: {
    key: "responsibility",
    label: "Responsibility code",
    hint: "From the installed role pack. One that adds a protected permission is refused.",
  },
};

export interface RoleOverridesInitial {
  view: OverridesView;
}

export function RoleOverridesScreen({ initial }: { initial?: RoleOverridesInitial } = {}) {
  const [view, setView] = useState<OverridesView | null>(initial?.view ?? null);
  const [template, setTemplate] = useState("");
  const [kind, setKind] = useState<OverrideKind>("rename");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<(typeof NARROWING_SCOPES)[number]>("campus");
  const [until, setUntil] = useState("");
  const [formError, setFormError] = useState<{ field: string; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);

  const reload = useCallback(async () => {
    try {
      setView(await listRoleOverrides());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await fn();
      setNotice(label);
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function payloadFor(): Record<string, unknown> {
    if (kind === "scope_narrow") return { scope };
    const field = FIELD[kind];
    if (!field) return {};
    if (kind === "approval_limit") return { [field.key]: Number(value) };
    if (kind === "disable" && !value.trim()) return {};
    return { [field.key]: value.trim() };
  }

  function onPropose(event: FormEvent) {
    event.preventDefault();
    const effectiveTo = until ? new Date(until).toISOString() : null;
    const parsed = overrideInputSchema.safeParse({
      template: template.trim(),
      kind,
      payload: payloadFor(),
      effectiveTo,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const first = String(issue?.path[0] ?? "template");
      setFormError({
        field: first === "payload" ? "value" : first === "effectiveTo" ? "until" : first,
        text: issue?.message ?? "Check the form.",
      });
      return;
    }
    setFormError(null);
    void act("Override proposed. It has no effect until a second administrator approves it.", () =>
      proposeRoleOverride({ data: parsed.data }),
    ).then(() => {
      setValue("");
    });
  }

  const err = (field: string) => (formError?.field === field ? formError.text : undefined);
  if (loading) return <p role="status">Loading role overrides…</p>;
  const me = view?.caller.userId ?? "";
  const field = FIELD[kind];
  return (
    <section className="app-shell-section" data-testid="role-overrides-screen">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <nav aria-label="Role tools" className="flex flex-wrap gap-4 text-sm">
        <Link className={TARGET} to={appShellSectionPath("roles") as never}>
          Roles and assignments
        </Link>
        <Link className={TARGET} to={appShellSectionPath("role-builder") as never}>
          Custom roles
        </Link>
        <Link className={TARGET} to={appShellSectionPath("access-reviews") as never}>
          Access reviews
        </Link>
      </nav>
      <h1>Role overrides</h1>
      <p className="text-sm text-muted-foreground">
        Adjust a role for your organization. A change takes effect only after a second administrator
        approves it. Guardrails and separation-of-duties rules cannot be overridden.
      </p>
      <ErrorAlert error={error} />
      {notice ? <p role="status">{notice}</p> : null}
      {view && !view.caller.isAdmin ? (
        <p role="alert">Only an administrator can manage role overrides.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Propose an override</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" noValidate onSubmit={onPropose}>
                <FieldShell
                  label="Role template"
                  hint="The code of a template in your installed role pack."
                  error={err("template")}
                >
                  {(p) => (
                    <input
                      {...p}
                      className={inputClass}
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </FieldShell>
                <FieldShell label="What to change" error={err("kind")}>
                  {(p) => (
                    <select
                      {...p}
                      className={inputClass}
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as OverrideKind);
                        setValue("");
                      }}
                    >
                      {OVERRIDE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </FieldShell>
                {kind === "scope_narrow" ? (
                  <FieldShell
                    label="Narrow to"
                    hint="Must be narrower than the template's own scope."
                    error={err("value")}
                  >
                    {(p) => (
                      <select
                        {...p}
                        className={inputClass}
                        value={scope}
                        onChange={(e) => setScope(e.target.value as typeof scope)}
                      >
                        {NARROWING_SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </FieldShell>
                ) : field ? (
                  <FieldShell label={field.label} hint={field.hint} error={err("value")}>
                    {(p) => (
                      <input
                        {...p}
                        className={inputClass}
                        value={value}
                        inputMode={kind === "approval_limit" ? "numeric" : undefined}
                        onChange={(e) => setValue(e.target.value)}
                        autoComplete="off"
                      />
                    )}
                  </FieldShell>
                ) : null}
                <FieldShell
                  label="Ends (optional)"
                  hint="Leave empty to keep it until someone ends it."
                  error={err("until")}
                >
                  {(p) => (
                    <input
                      {...p}
                      type="datetime-local"
                      className={inputClass}
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                    />
                  )}
                </FieldShell>
                <Button type="submit" className={TARGET} disabled={busy}>
                  Propose override
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Overrides</CardTitle>
            </CardHeader>
            <CardContent>
              {!view || view.rows.length === 0 ? (
                <p>No overrides yet.</p>
              ) : (
                <ul className="grid gap-3" aria-label="Role overrides">
                  {view.rows.map((row) => {
                    const mine = row.createdBy === me;
                    return (
                      <li key={row.id} className="grid gap-1 rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{row.template}</strong>
                          <StatusBadge status={row.state} />
                        </div>
                        <p>{describeOverride(row.kind, row.payload)}</p>
                        {row.effectiveTo ? (
                          <p className="text-xs text-muted-foreground">Ends {row.effectiveTo}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {row.state === "pending" ? (
                            <Button
                              type="button"
                              className={TARGET}
                              disabled={busy || mine}
                              aria-describedby={mine ? `own-${row.id}` : undefined}
                              onClick={() =>
                                void act("Override approved and audited.", () =>
                                  approveRoleOverride({ data: { id: row.id } }),
                                )
                              }
                            >
                              Approve
                            </Button>
                          ) : null}
                          {row.state !== "ended" ? (
                            <Button
                              type="button"
                              variant="outline"
                              className={TARGET}
                              disabled={busy}
                              onClick={() =>
                                void act("Override ended. It stays as history.", () =>
                                  endRoleOverride({ data: { id: row.id } }),
                                )
                              }
                            >
                              {row.state === "pending" ? "Withdraw" : "End now"}
                            </Button>
                          ) : null}
                        </div>
                        {row.state === "pending" && mine ? (
                          <p id={`own-${row.id}`} className="text-xs text-muted-foreground">
                            You proposed this, so a second administrator must approve it.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
