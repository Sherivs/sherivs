import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { PlannedCapabilityState } from "@/components/planned-capability-state";
import {
  KERNEL_EVENT_STATES,
  loadKernelEventOutboxState,
  loadPlatformAuditTrail,
  type KernelEventOutboxState,
  type PlatformAuditTrail,
} from "@/lib/command-centre.functions";

export const Route = createFileRoute("/_authenticated/command-centre/")({
  ssr: false,
  component: CommandCentreOperations,
  head: () => ({
    meta: [
      { title: "CoreGrid — Command centre operations projection" },
      {
        name: "description",
        content:
          "The platform operations projection: real platform audit activity and kernel event-outbox state, read through the platform super-admin gate. Alert, incident and decision projections are planned capability — no numbers are invented for them.",
      },
    ],
  }),
});

/**
 * V1-012 honest-substrate disposition (§57 no product theatre).
 *
 * The former /command-centre page was a hardcoded demonstration substrate: a
 * fabricated tenant scope with invented alerts, incidents, decision
 * records and delta counters rendered to ANY visitor, authenticated or not.
 * Every one of those record classes has no V1 database substrate (phase 19's
 * "alert definitions" / "alert state" / "incidents" substrates are pure
 * in-memory contract modules; no migration creates a backing table), so they
 * are classified as planned capability below — never re-skin as fabricated
 * queries.
 *
 * The two sections that DO have real, existing DB substrate are read live
 * through `lib/command-centre.functions.ts` (requireSupabaseAuth →
 * platform-super gate with lifecycle/session threading → pure reads). The
 * frontend renders what the server returned or an honest error/empty state —
 * it never substitutes numbers (AGENTS §34).
 */
function CommandCentreOperations() {
  const audit = useServerFn(loadPlatformAuditTrail);
  const outbox = useServerFn(loadKernelEventOutboxState);

  const auditQuery = useQuery({
    queryKey: ["command-centre-platform-audit"],
    queryFn: () => audit(),
    retry: false,
  });

  const outboxQuery = useQuery({
    queryKey: ["command-centre-outbox-state"],
    queryFn: () => outbox(),
    retry: false,
  });

  return (
    <PortalPage
      title="Command centre — operations projection"
      subtitle="Platform-scoped · read-only over real platform state · authorization resolved server-side (platform super-admin gate)"
    >
      <div className="space-y-6">
        <section aria-label="Platform administrative audit trail">
          <h2 className="font-display text-base font-semibold">
            Platform administrative audit trail
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Read live from the platform's own audit surface (super_admin_logs) through the
            platform super-admin gate.
          </p>
          {auditQuery.isError ? (
            <EmptyCard
              title="Platform audit trail could not be loaded"
              body={
                auditQuery.error instanceof Error
                  ? auditQuery.error.message
                  : "The audit trail is not available right now. No numbers are invented in its place."
              }
              action={
                <Button variant="outline" onClick={() => void auditQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : auditQuery.isPending ? (
            <EmptyCard title="Loading platform audit trail…" body="Reading real logged platform administrative events." />
          ) : (
            <PlatformAuditSection trail={auditQuery.data} />
          )}
        </section>

        <section aria-label="Kernel event outbox state">
          <h2 className="font-display text-base font-semibold">Kernel event outbox state</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Delivery-state aggregates over the kernel event/outbox registry (cg_event) —
            counts only; no event payloads or tenant references are surfaced.
          </p>
          {outboxQuery.isError ? (
            <EmptyCard
              title="Kernel event outbox state could not be loaded"
              body={
                outboxQuery.error instanceof Error
                  ? outboxQuery.error.message
                  : "The outbox state is not available right now. No numbers are invented in its place."
              }
              action={
                <Button variant="outline" onClick={() => void outboxQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : outboxQuery.isPending ? (
            <EmptyCard title="Loading kernel event outbox state…" body="Reading real delivery-state aggregates." />
          ) : (
            <OutboxStateSection state={outboxQuery.data} />
          )}
        </section>

        <PlannedCapabilityState
          capability="Open-alert projection"
          note="Phase 19 owns alert definitions and alert state; no alert substrate table exists in V1, so there is nothing to project and no number to show. The originating subsystems stay responsible for alert semantics."
          realSurfaces={[
            { label: "Platform logs", to: "/super-admin/logs" },
            { label: "Platform audit trail (above)", to: "/command-centre" },
          ]}
        />

        <PlannedCapabilityState
          capability="Incident tracking & observation closures"
          note="Incident records with lifecycle state and the Outcome → Observation closure tail require an incident substrate that is not in V1. Declared correlations are never invented here."
        />

        <PlannedCapabilityState
          capability="Append-only decision records & observation-cursor deltas"
          note="Human decision records over incidents and delta projection since an operator's observation cursor require a decision-ledger substrate and a persisted cursor — neither is in V1."
        />
      </div>
    </PortalPage>
  );
}

function PlatformAuditSection({ trail }: { trail: PlatformAuditTrail }) {
  return (
    <div className="space-y-3">
      <SectionGrid>
        <StatCard label="Total administrative events" value={String(trail.totalEvents)} />
        <StatCard label="Events in the last 24 hours" value={String(trail.eventsLast24h)} />
        <StatCard
          label="Last platform administrative event"
          value={trail.lastEventAt ? new Date(trail.lastEventAt).toLocaleString() : "No events yet"}
        />
      </SectionGrid>
      {trail.recentActions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No platform administrative actions recorded yet — an empty trail is displayed as empty.
        </p>
      ) : (
        <ul className="space-y-2">
          {trail.recentActions.map((event) => (
            <li
              key={`${event.action}-${event.at}`}
              className="rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground"
            >
              {event.action} · {new Date(event.at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OutboxStateSection({ state }: { state: KernelEventOutboxState }) {
  return (
    <div className="space-y-3">
      <SectionGrid>
        <StatCard label="Total kernel events" value={String(state.totalEvents)} />
        {KERNEL_EVENT_STATES.map((stateName) => (
          <StatCard
            key={stateName}
            label={`Events in state "${stateName}"`}
            value={String(state.byState[stateName])}
          />
        ))}
        <StatCard
          label="Last event occurred at"
          value={
            state.lastOccurredAt ? new Date(state.lastOccurredAt).toLocaleString() : "No events yet"
          }
        />
      </SectionGrid>
      {state.byState.failed + state.byState.dead > 0 ? (
        <p className="text-sm text-rose-600">
          {state.byState.failed + state.byState.dead} kernel event(s) are in a failure state — this
          is real outbox state, surfaced, not absorbed.
        </p>
      ) : null}
    </div>
  );
}