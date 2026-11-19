/**
 * Access-review campaigns (mission M4, ADR-116) over the M13 tables and functions: start a
 * campaign over every active assignment, reviewers keep or revoke each one, the campaign completes
 * when nothing is pending. Every decision is written to role_access_review_audit_events.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_SHELL_HOME, appShellSectionPath } from "@/lib/shell/paths";
import type { ReviewCampaign } from "@/lib/role-builder/access-delegation";
import {
  decideAccessReviewItem,
  listAccessReviews,
  startAccessReview,
} from "@/lib/role-builder/access-delegation.functions";
import { ErrorAlert, FieldShell, StatusBadge, TARGET, inputClass } from "./role-builder-ui";

export function AccessReviewScreen({
  initial,
}: { initial?: { campaigns: ReviewCampaign[]; me: string } } = {}) {
  const [campaigns, setCampaigns] = useState<ReviewCampaign[]>(initial?.campaigns ?? []);
  const [me, setMe] = useState(initial?.me ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [formError, setFormError] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);

  const reload = useCallback(async () => {
    try {
      const result = await listAccessReviews();
      setCampaigns(result.campaigns);
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

  function onStart(event: FormEvent) {
    event.preventDefault();
    const parsed = due ? Date.parse(due) : Number.NaN;
    if (title.trim().length < 2) return setFormError("Give the campaign a title.");
    if (Number.isNaN(parsed)) return setFormError("Choose a due date.");
    setFormError("");
    void act("Campaign started and audited.", () =>
      startAccessReview({ data: { title: title.trim(), dueAt: new Date(parsed).toISOString() } }),
    );
  }

  if (loading) return <p role="status">Loading access reviews…</p>;
  return (
    <section className="app-shell-section" data-testid="access-review-screen">
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
        <Link className={TARGET} to={appShellSectionPath("delegations") as never}>
          Delegations
        </Link>
      </nav>
      <h1>Access reviews</h1>
      <p className="text-sm text-muted-foreground">
        Re-confirm who holds which role. You cannot decide your own access.
      </p>
      <ErrorAlert error={error} />
      {notice ? <p role="status">{notice}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>Start a campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" noValidate onSubmit={onStart}>
            <FieldShell
              label="Title"
              error={formError && title.trim().length < 2 ? formError : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </FieldShell>
            <FieldShell
              label="Due"
              hint="Every active assignment is added to the campaign."
              error={formError && title.trim().length >= 2 ? formError : undefined}
            >
              {(p) => (
                <input
                  {...p}
                  type="datetime-local"
                  className={inputClass}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              )}
            </FieldShell>
            <Button type="submit" className={`${TARGET} justify-self-start`} disabled={busy}>
              Start campaign
            </Button>
          </form>
        </CardContent>
      </Card>
      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No campaigns yet. Start one above.</p>
      ) : null}
      {campaigns.map((campaign) => {
        const pending = campaign.items.filter((i) => i.status === "pending").length;
        return (
          <Card key={campaign.id} data-campaign={campaign.id}>
            <CardHeader>
              <CardTitle>
                {campaign.title} <StatusBadge status={campaign.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>
                Due {campaign.dueAt}. {campaign.items.length - pending} of {campaign.items.length}{" "}
                decided. {campaign.auditCount} audit events.
              </p>
              <ul className="grid gap-2">
                {campaign.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {item.userName} · {item.roleName}
                    </span>
                    <StatusBadge status={item.status} />
                    {item.status === "pending" && campaign.status === "open" ? (
                      item.userId === me ? (
                        <span className="text-xs">Your own access: another reviewer decides.</span>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            className={TARGET}
                            disabled={busy}
                            aria-label={`Keep ${item.roleName} for ${item.userName}`}
                            onClick={() =>
                              void act("Kept and audited.", () =>
                                decideAccessReviewItem({
                                  data: { itemId: item.id, decision: "retain" },
                                }),
                              )
                            }
                          >
                            Keep
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            className={TARGET}
                            disabled={busy}
                            aria-label={`Revoke ${item.roleName} from ${item.userName}`}
                            onClick={() =>
                              void act("Revoked and audited.", () =>
                                decideAccessReviewItem({
                                  data: { itemId: item.id, decision: "revoke" },
                                }),
                              )
                            }
                          >
                            Revoke
                          </Button>
                        </>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
