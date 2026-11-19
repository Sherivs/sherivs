/**
 * Delegation and acting roles (mission M4, ADR-121): grant a time-boxed delegation of an active
 * assignment (leave cover, acting head). The end can never be later than the source assignment's
 * end; the database refuses it (M009 RPC and the M4 table guard) and trims or revokes delegations
 * when the source is shortened or ended.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_SHELL_HOME, appShellSectionPath } from "@/lib/shell/paths";
import type { AssignmentRow, DelegationRow } from "@/lib/role-builder/access-delegation";
import {
  grantDelegation,
  listDelegations,
  revokeDelegation,
} from "@/lib/role-builder/access-delegation.functions";
import { ErrorAlert, FieldShell, StatusBadge, TARGET, inputClass } from "./role-builder-ui";

function toInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface DelegationInitial {
  assignments: AssignmentRow[];
  delegations: DelegationRow[];
  members: { id: string; name: string }[];
  me: string;
  assignmentId?: string;
}

export function DelegationScreen({ initial }: { initial?: DelegationInitial } = {}) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initial?.assignments ?? []);
  const [delegations, setDelegations] = useState<DelegationRow[]>(initial?.delegations ?? []);
  const [members, setMembers] = useState<{ id: string; name: string }[]>(initial?.members ?? []);
  const [me, setMe] = useState(initial?.me ?? "");
  const [assignmentId, setAssignmentId] = useState(initial?.assignmentId ?? "");
  const [delegateId, setDelegateId] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [formError, setFormError] = useState<{ field: string; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);

  const reload = useCallback(async () => {
    try {
      const result = await listDelegations();
      setAssignments(result.assignments);
      setDelegations(result.delegations);
      setMembers(result.members);
      setMe(result.me);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  const source = assignments.find((a) => a.id === assignmentId) ?? null;

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

  function onGrant(event: FormEvent) {
    event.preventDefault();
    if (!source)
      return setFormError({ field: "assignment", text: "Choose the assignment to delegate." });
    if (!delegateId) return setFormError({ field: "delegate", text: "Choose who covers." });
    const start = Date.parse(from);
    const end = Date.parse(until);
    if (Number.isNaN(start)) return setFormError({ field: "from", text: "Choose a start." });
    if (Number.isNaN(end) || end <= start)
      return setFormError({ field: "until", text: "The end must be after the start." });
    if (source.validUntil && end > Date.parse(source.validUntil))
      return setFormError({
        field: "until",
        text: `The source assignment ends ${source.validUntil}; a delegation cannot end later.`,
      });
    setFormError(null);
    void act("Delegation granted and audited.", () =>
      grantDelegation({
        data: {
          assignmentId: source.id,
          delegateUserId: delegateId,
          validFrom: new Date(start).toISOString(),
          validUntil: new Date(end).toISOString(),
        },
      }),
    );
  }

  const err = (field: string) => (formError?.field === field ? formError.text : undefined);
  if (loading) return <p role="status">Loading delegations…</p>;
  return (
    <section className="app-shell-section" data-testid="delegation-screen">
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
      <h1>Delegations and acting roles</h1>
      <ErrorAlert error={error} />
      {notice ? <p role="status">{notice}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>Grant a delegation</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" noValidate onSubmit={onGrant}>
            <FieldShell label="Assignment to delegate" error={err("assignment")}>
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={assignmentId}
                  onChange={(e) => {
                    setAssignmentId(e.target.value);
                    const next = assignments.find((a) => a.id === e.target.value);
                    if (next?.validUntil) setUntil(toInputValue(next.validUntil));
                  }}
                >
                  <option value="">Choose…</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.roleName} · {a.userName}
                      {a.validUntil ? ` (until ${a.validUntil})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </FieldShell>
            <FieldShell label="Who covers" error={err("delegate")}>
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={delegateId}
                  onChange={(e) => setDelegateId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {members
                    .filter((m) => m.id !== me && m.id !== source?.userId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              )}
            </FieldShell>
            <FieldShell label="Starts" error={err("from")}>
              {(p) => (
                <input
                  {...p}
                  type="datetime-local"
                  className={inputClass}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              )}
            </FieldShell>
            <FieldShell
              label="Ends"
              hint={
                source?.validUntil
                  ? `No later than ${source.validUntil}.`
                  : "Required: delegations are always time-boxed."
              }
              error={err("until")}
            >
              {(p) => (
                <input
                  {...p}
                  type="datetime-local"
                  className={inputClass}
                  value={until}
                  max={toInputValue(source?.validUntil ?? null) || undefined}
                  onChange={(e) => setUntil(e.target.value)}
                />
              )}
            </FieldShell>
            <Button type="submit" className={`${TARGET} justify-self-start`} disabled={busy}>
              Grant delegation
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delegations</CardTitle>
        </CardHeader>
        <CardContent>
          {delegations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No delegations yet.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {delegations.map((d) => {
                const a = assignments.find((x) => x.id === d.assignmentId);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {d.delegateName} covers{" "}
                      {a ? `${a.roleName} for ${a.userName}` : "an ended assignment"} ·{" "}
                      {d.validFrom} to {d.validUntil}
                    </span>
                    <StatusBadge status={d.revokedAt ? "revoked" : "in_force"} />
                    {!d.revokedAt ? (
                      <Button
                        type="button"
                        variant="outline"
                        className={TARGET}
                        disabled={busy}
                        aria-label={`Revoke the delegation to ${d.delegateName}`}
                        onClick={() =>
                          void act("Delegation revoked and audited.", () =>
                            revokeDelegation({ data: { id: d.id } }),
                          )
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
