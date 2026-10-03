import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlannedCapabilityState } from "@/components/planned-capability-state";
import {
  launchWorkerMission,
  WORKER_LAUNCH_AUDIT_ACTION,
  type WorkerLaunchOutcome,
} from "@/lib/workforce/worker-launch.functions";

export const Route = createFileRoute("/_authenticated/super-admin/worker-missions")({
  ssr: false,
  component: WorkerMissionsPage,
  head: () => ({
    meta: [
      { title: "CoreGrid — Worker mission launch" },
      {
        name: "description",
        content:
          "Launch one governed worker mission through the platform super-admin gate: the server function authenticates, authorizes, validates against the worker registry and delegation-grant substrate, and runs one worker-host cycle. Live AI execution stays credential-gated and fail-closed.",
      },
    ],
  }),
});

/**
 * R7 WORKFORCE-SURFACE — the operational launch surface for worker missions
 * (F-13 typed skip T8: "no HTTP/UI path to launch a worker mission").
 *
 * The page is deliberately small and honest (§57): the ONLY action it exposes
 * is the real server function `launchWorkerMission`, and it renders exactly
 * the typed outcome the server returned. The UI is not security (§34): the
 * RoleGuard above only shapes navigation — every launch decision is enforced
 * server-side by `requirePlatformSuperAdmin` inside the server function.
 * When the AI credential is absent the server returns the typed
 * BLOCKED_NO_CREDENTIAL outcome and this page shows the block as a block —
 * it never dresses a denial up as a launch.
 */
function WorkerMissionsPage() {
  const launch = useServerFn(launchWorkerMission);
  const [tenantId, setTenantId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [executionId, setExecutionId] = useState("");

  const launchMutation = useMutation({
    mutationFn: () => launch({ data: { tenantId, workerId, executionId } }),
  });

  return (
    <PortalPage
      title="Worker missions — launch surface"
      subtitle="Control-plane scope · one governed worker-host cycle per launch · authorization resolved server-side (platform super-admin gate)"
    >
      <div className="space-y-6">
        <section aria-label="Launch a worker mission">
          <h2 className="font-display text-base font-semibold">Launch a worker mission</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Runs the full §27 chain server-side: authenticate → platform super-admin gate → Zod
            contract → substrate validation (execution exists; worker resolves authority through
            the registry: lifecycle, quarantine ledger, active delegation grants, escalation
            checks) → credential gate → one WAKE → EXECUTE → PERSIST → VERIFY → SLEEP host cycle →
            fail-closed audit record.
          </p>
          <form
            className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              void launchMutation.mutateAsync();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="worker-launch-tenant">Tenant scope</Label>
              <Input
                id="worker-launch-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="tenant id the launch targets"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="worker-launch-worker">Worker definition id</Label>
              <Input
                id="worker-launch-worker"
                value={workerId}
                onChange={(event) => setWorkerId(event.target.value)}
                placeholder="governed worker (definition) id"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="worker-launch-execution">Execution id</Label>
              <Input
                id="worker-launch-execution"
                value={executionId}
                onChange={(event) => setExecutionId(event.target.value)}
                placeholder="claimed execution id"
                autoComplete="off"
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={launchMutation.isPending}>
                {launchMutation.isPending ? "Launching…" : "Launch worker mission"}
              </Button>
            </div>
          </form>
          {launchMutation.isError ? (
            <EmptyCard
              title="Launch could not be completed"
              body={
                launchMutation.error instanceof Error
                  ? launchMutation.error.message
                  : "The server function failed. Nothing is invented in its place."
              }
              action={
                <Button variant="outline" onClick={() => void launchMutation.reset()}>
                  Dismiss
                </Button>
              }
            />
          ) : null}
          {launchMutation.data ? (
            <LaunchOutcomeCard outcome={launchMutation.data} />
          ) : null}
        </section>

        <section aria-label="How the launch surface is gated">
          <h2 className="font-display text-base font-semibold">Gating posture</h2>
          <SectionGrid>
            <StatCard label="Authorization gate" value="requirePlatformSuperAdmin" />
            <StatCard label="Request contract" value="Zod strict" />
            <StatCard label="Audit action" value={WORKER_LAUNCH_AUDIT_ACTION} />
            <StatCard label="Credential gate" value="AI_API_KEY (BLK-2)" />
          </SectionGrid>
          <p className="mt-3 text-xs text-muted-foreground">
            Every attempt — denied, blocked or launched — writes a fail-closed audit record naming
            the actor, the targeted execution, the outcome and the deny/block code. No credential
            values are ever logged or audited.
          </p>
        </section>

        <PlannedCapabilityState
          capability="Live AI worker execution at scale"
          note="The launch surface, registry substrate and host lifecycle are real. Live inference additionally requires the AI_API_KEY credential (BLK-2), an external gate owned outside this codebase; until it is provisioned by name every launch returns the typed BLOCKED_NO_CREDENTIAL outcome and no provider contact is made. EXTERNAL REVIEW PENDING."
          realSurfaces={[
            { label: "Agent governance", to: "/super-admin/agent-governance" },
            { label: "Platform logs", to: "/super-admin/logs" },
          ]}
        />
      </div>
    </PortalPage>
  );
}

function LaunchOutcomeCard({ outcome }: { outcome: WorkerLaunchOutcome }) {
  if (outcome.outcome === "denied") {
    return (
      <EmptyCard
        title={`Denied — ${outcome.code}`}
        body={`${outcome.reason} · Audit record "${outcome.audit.action}" written with outcome "${outcome.audit.outcome}".`}
      />
    );
  }
  if (outcome.outcome === "blocked_no_credential") {
    return (
      <EmptyCard
        title={`Blocked — ${outcome.code}`}
        body={`${outcome.reason} Missing environment: ${outcome.missingEnvironment.join(", ")}. Audit record "${outcome.audit.action}" written with outcome "${outcome.audit.outcome}".`}
      />
    );
  }
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-display text-sm font-semibold">
        Launched — governed host cycle complete (runtime {outcome.host.runtimeInstanceId})
      </h3>
      <SectionGrid>
        <StatCard label="Execute outcome" value={outcome.host.execute.outcome} />
        <StatCard label="Evidence persisted" value={String(outcome.host.persist.evidenceCount)} />
        <StatCard
          label="Independent verification"
          value={outcome.host.verify.attempted ? outcome.host.verify.decision ?? "recorded" : "pending — awaits an independent verifier"}
        />
        <StatCard
          label="Quarantined"
          value={outcome.host.sleep.quarantined ? "yes" : "no"}
        />
      </SectionGrid>
      <ul className="space-y-1">
        {outcome.host.phases.map((phase) => (
          <li
            key={`${phase.phase}-${phase.detail}`}
            className="rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground"
          >
            {phase.phase} {phase.ok ? "✓" : "✗"} · {phase.detail}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Audit record &quot;{outcome.audit.action}&quot; written with outcome
        &quot;{outcome.audit.outcome}&quot;.
      </p>
    </div>
  );
}