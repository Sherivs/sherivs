/**
 * Always-visible "acting as / delegated" banner (mission M4, ADR-116; master brief §10.1 and
 * Appendix D "Acting Principal / Acting HOD: delegation with expiry and an audit banner").
 * Shows the caller's own active delegations and acting assignments, from
 * `workspace_my_acting_context()`. Renders nothing when there are none or the lookup fails.
 */
import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import type { ActingContextRow } from "@/lib/role-builder/access-delegation";
import { getMyActingContext } from "@/lib/role-builder/access-delegation.functions";

export function actingBannerText(rows: readonly ActingContextRow[]): string[] {
  return rows.map((row) => {
    const until = row.validUntil ? ` until ${row.validUntil.slice(0, 16).replace("T", " ")}` : "";
    return row.kind === "delegated"
      ? `Delegated: you are covering ${row.roleName}${row.holderName ? ` for ${row.holderName}` : ""}${until}. Actions are recorded under your name.`
      : `Acting as ${row.roleName}${until}. Actions are recorded under your name.`;
  });
}

const defaultLoad = () => getMyActingContext();

export function ActingContextBanner({
  load = defaultLoad,
  refreshKey,
  initialRows,
}: {
  load?: () => Promise<ActingContextRow[]>;
  refreshKey?: string;
  /** Seeds the banner (server render, tests) and skips the lookup. */
  initialRows?: ActingContextRow[];
}) {
  const [rows, setRows] = useState<ActingContextRow[]>(initialRows ?? []);
  useEffect(() => {
    if (initialRows) return;
    let live = true;
    load()
      .then((result) => {
        if (live) setRows(result);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [load, refreshKey, initialRows]);
  if (rows.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="app-shell-acting-banner flex items-start gap-2 border-b px-4 py-2 text-sm"
      data-testid="acting-context-banner"
    >
      <UserCog aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <ul className="grid gap-0.5">
        {actingBannerText(rows).map((text, i) => (
          <li key={i}>
            <strong>{rows[i]!.kind === "delegated" ? "Delegated" : "Acting"}</strong>{" "}
            {text.replace(/^(Delegated: |Acting as )/, rows[i]!.kind === "acting" ? "as " : "")}
          </li>
        ))}
      </ul>
    </div>
  );
}
