/**
 * Sherivs — honest planned-capability state (§57 no product theatre).
 *
 * Rendered by pages whose capability is real future scope, classified in the
 * typed disposition registry (`lib/runtime/scholar/placeholder-dispositions.ts`). The state
 * says exactly two things: the capability is planned, and it is not in V1.
 * It never renders numbers (a static zero posing as data is a violation) and
 * never renders a disabled action (a control that cannot act is theatre).
 */
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

export function PlannedCapabilityState({
  capability,
  note,
  realSurfaces,
}: {
  capability: string;
  note?: string;
  /** Honest cross-links to real V1 surfaces that already serve adjacent data. */
  realSurfaces?: { label: string; to: string }[];
}) {
  return (
    <div className="uos-card p-8 text-center" data-testid="planned-capability-state">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 border border-primary/20">
        <CalendarClock className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-display text-lg font-semibold">{capability}</h3>
      <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
        Planned capability — not in V1.
      </p>
      {note && (
        <p className="mx-auto mt-3 max-w-md text-sm text-[color:var(--text-secondary)]">{note}</p>
      )}
      {realSurfaces && realSurfaces.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {realSurfaces.map((surface) => (
            <Link
              key={surface.to}
              to={surface.to}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              {surface.label}
            </Link>
          ))}
        </div>
      )}
      <p className="mt-6 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
        No data exists for this capability yet — none is invented here
      </p>
    </div>
  );
}
