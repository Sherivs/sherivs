import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  appendIncidentDecision,
  projectCommandCentre,
  type IncidentDecisionRecord,
} from "@/lib/command-centre";
import { createCommandAlert, type CommandAlert } from "@/lib/command-alerts";
import { createIncident, type Incident } from "@/lib/command-incidents";
import { tenantId } from "@/lib/tenant-core";

export const Route = createFileRoute("/command-centre")({
  component: CommandCentreOperations,
  head: () => ({
    meta: [
      { title: "CoreGrid — Command centre operations projection" },
      {
        name: "description",
        content:
          "The operational projection surface: open alerts, incidents, human decision records and observation closures — read-only over the declared substrates.",
      },
    ],
  }),
});

/**
 * DEMONSTRATION SUBSTRATE — declared records shaped exactly as the server
 * would admit them. This page is display-only (AGENTS §34): tenant context,
 * record intake and authorization are all resolved server-side before any
 * record reaches the projection; nothing here grants or gates anything.
 */
const DEMO_TENANT = tenantId("tenant:demo");
const OTHER_TENANT = tenantId("tenant:other");

function demoSubstrate(): {
  alerts: CommandAlert[];
  incidents: Incident[];
  decisions: readonly IncidentDecisionRecord[];
} {
  const alertSeed = { tenantId: DEMO_TENANT, createdAt: "2026-10-01T08:00:00Z" };
  const alerts = [
    createCommandAlert({
      ...alertSeed,
      alertId: "alert-1",
      source: "security",
      sourceAlertId: "src-1",
      severity: "CRITICAL",
      summary: "Repeated failed sign-ins against an administrative identity",
      impactedScope: ["identity:admin-7"],
    }),
    createCommandAlert({
      ...alertSeed,
      alertId: "alert-2",
      source: "infrastructure",
      sourceAlertId: "src-2",
      severity: "HIGH",
      summary: "Backup job did not complete in its declared window",
      impactedScope: ["infra:backup-worker-1"],
    }),
    createCommandAlert({
      tenantId: OTHER_TENANT,
      createdAt: "2026-10-01T08:05:00Z",
      alertId: "alert-foreign",
      source: "analytics",
      sourceAlertId: "src-foreign",
      severity: "LOW",
      summary: "Foreign-tenant alert — never projected",
      impactedScope: [],
    }),
  ].flatMap((result) => (result.ok ? [result.alert] : []));
  alerts[0] = { ...alerts[0], correlationGroup: "incident-1", status: "ESCALATED" };
  alerts[1] = { ...alerts[1], correlationGroup: "incident-1" };

  const incidentResult = createIncident({
    incidentId: "incident-1",
    tenantId: DEMO_TENANT,
    kind: "security_incident",
    severity: "CRITICAL",
    scope: ["identity:admin-7"],
    detectedAt: "2026-10-01T08:10:00Z",
  });
  const incident = incidentResult.ok ? incidentResult.incident : null;
  const closedIncidentResult = createIncident({
    incidentId: "incident-2",
    tenantId: DEMO_TENANT,
    kind: "automation_failure",
    severity: "HIGH",
    scope: ["automation:billing-run"],
    detectedAt: "2026-10-01T06:00:00Z",
  });
  const closedIncident = closedIncidentResult.ok
    ? {
        ...closedIncidentResult.incident,
        state: "RESOLVED" as const,
        resolvedAt: "2026-10-01T07:30:00Z",
        evidence: [{ evidenceId: "ev-1", source: "automation", reference: "evidence:run-42" }],
      }
    : null;
  const incidents: Incident[] =
    incident == null
      ? []
      : closedIncident == null
        ? [incident]
        : [incident, closedIncident];

  const decisions: readonly IncidentDecisionRecord[] = appendIncidentDecision([], {
    decisionId: "decision-1",
    tenantId: DEMO_TENANT,
    incidentId: "incident-2",
    decidedBy: "user:operator-1",
    rationale: "Reviewed the run evidence; the failure was transient and the rerun succeeded.",
    evidenceRefs: ["evidence:run-42"],
    decidedAt: "2026-10-01T07:40:00Z",
  });

  return { alerts, incidents, decisions };
}

function CommandCentreOperations() {
  const { alerts, incidents, decisions } = demoSubstrate();
  const projection = projectCommandCentre({
    tenantId: DEMO_TENANT,
    alerts,
    incidents,
    decisions,
    cursor: { tenantId: DEMO_TENANT, sinceAt: "2026-10-01T07:00:00Z" },
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-display text-lg font-bold leading-tight">
              Command centre — operations projection
            </h1>
            <p className="text-xs text-muted-foreground">
              Tenant-scoped · read-only over the declared substrates · decisions are append-only
            </p>
          </div>
          <Badge variant="outline">{projection.tenantId}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <p className="text-sm text-muted-foreground">
          Demonstration projection over declared records — the surface renders the projection
          contract&apos;s shapes; it never mutates canonical truth and never authorizes. All
          authorization remains server-side.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Open alerts ({projection.openAlerts.length})</CardTitle>
            <CardDescription className="text-xs">
              Severity-descending, oldest first; subject refs and first/last observed are the
              declared record&apos;s own values.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projection.openAlerts.map((alert) => (
              <div key={alert.alertId} className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      alert.severity === "CRITICAL" || alert.severity === "HIGH"
                        ? "border-0 bg-rose-500/10 text-rose-600"
                        : ""
                    }
                  >
                    {alert.severity}
                  </Badge>
                  <span className="font-semibold">{alert.summary}</span>
                  <Badge variant="outline">{alert.status}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {alert.source} · first {alert.firstObservedAt} · last {alert.lastObservedAt} ·
                  subjects {alert.subjectRefs.join(", ") || "—"} · incident{" "}
                  {alert.incidentId ?? "—"}
                </p>
              </div>
            ))}
            {projection.openAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open alerts in scope.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Incidents ({projection.incidents.length})</CardTitle>
            <CardDescription className="text-xs">
              Declared incident records with their lifecycle state and correlated open alerts —
              grouped only by the declared correlation, never invented.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projection.incidents.map((incident) => (
              <div key={incident.incidentId} className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{incident.kind}</span>
                  <Badge variant="outline">{incident.lifecycleState}</Badge>
                  {incident.closed ? <Badge variant="secondary">closed loop</Badge> : null}
                  <Badge variant="outline">{incident.severity}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {incident.alertIds.length} correlated alert(s) · {incident.decisionCount}{" "}
                  decision(s) · evidence {incident.evidenceRefs.join(", ") || "—"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Observation closures ({projection.closures.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Outcome recorded · observation recorded · evidence-bearing — the loop&apos;s Outcome
              → Observation tail closes here, and loop re-entry sees closed loops as closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projection.closures.map((closure) => (
              <div key={closure.incidentId} className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{closure.incidentId}</span>
                  <Badge variant={closure.closed ? "secondary" : "outline"}>
                    {closure.closed ? "CLOSED" : "OPEN LOOP"}
                  </Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  outcome {closure.outcomeRecorded ? "recorded" : "not recorded"} · observation{" "}
                  {closure.observationRecorded ? "recorded" : "not recorded"} · evidence{" "}
                  {closure.evidenceBearing ? closure.evidenceRefs.join(", ") : "none"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Decision records ({projection.decisions.length}) — append-only
            </CardTitle>
            <CardDescription className="text-xs">
              Human decisions over incidents, carried as separate append-only records with
              provenance. The centre never rewrites them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projection.decisions.map((decision) => (
              <div key={decision.decisionId} className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-semibold">{decision.rationale}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {decision.decidedBy} at {decision.decidedAt} · evidence{" "}
                  {decision.evidenceRefs.join(", ") || "—"}
                </p>
              </div>
            ))}
            {projection.decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decisions recorded.</p>
            ) : null}
            <Separator />
            <p className="font-mono text-[11px] text-muted-foreground">
              Delta since declared cursor: {projection.delta.newAlertIds.length} new alert(s),{" "}
              {projection.delta.updatedAlertIds.length} updated, {projection.delta.newIncidentIds.length}{" "}
              new incident(s), {projection.delta.incidentsClosedSince.length} closed,{" "}
              {projection.delta.newDecisionIds.length} new decision(s) · defects surfaced:{" "}
              {projection.defects.length} · foreign-tenant records excluded:{" "}
              {projection.excludedForeignTenantCount}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
