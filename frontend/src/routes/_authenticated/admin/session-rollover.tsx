/**
 * Admin session rollover (SHERIVS-016).
 * Step 1 previews the end-of-session move with public.session_rollover(dry run):
 * who is promoted, repeats (CGPA/carry-over rules), graduates or is skipped.
 * Step 2 applies it once; re-running the same sessions is a no-op. Every change
 * is recorded as a lifecycle event and an audit entry.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { nextSession, type RolloverSummary } from "@/lib/academics/grading";

export const Route = createFileRoute("/_authenticated/admin/session-rollover")({
  ssr: false,
  component: SessionRolloverPage,
});

function currentAcademicYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y - 1}/${y}` : `${y - 2}/${y - 1}`;
}

const DECISION_LABEL: Record<string, string> = {
  repeat: "Repeats",
  graduate: "Graduates",
  withdraw: "Withdrawn",
  transfer: "Transferred",
  skip: "Skipped (no rule)",
  promote: "Promoted",
};

async function runRollover(
  schoolId: string,
  from: string,
  to: string,
  dryRun: boolean,
): Promise<RolloverSummary> {
  const { data, error } = await supabase.rpc("session_rollover", {
    p_school: schoolId,
    p_from: from,
    p_to: to,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  return data as unknown as RolloverSummary;
}

function SessionRolloverPage() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const isAdmin = profile?.role === "admin" || profile?.role === "principal";
  const [from, setFrom] = useState(currentAcademicYear());
  const [to, setTo] = useState(nextSession(currentAcademicYear()) ?? "");
  const [preview, setPreview] = useState<RolloverSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function doPreview() {
    if (!schoolId) return;
    setBusy(true);
    try {
      setPreview(await runRollover(schoolId, from, to, true));
      setConfirmText("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doApply() {
    if (!schoolId || !preview) return;
    setBusy(true);
    try {
      const r = await runRollover(schoolId, from, to, false);
      setPreview(r);
      toast.success(
        r.already_applied
          ? "This rollover was already applied; nothing changed."
          : `Rollover applied: ${r.promoted} promoted, ${r.repeated} repeating, ${r.graduated} graduated.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <PortalPage
        title="Session rollover"
        subtitle="Only the school admin or principal can run a rollover."
      >
        <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
      </PortalPage>
    );
  }

  const valid = /^\d{4}\/\d{4}$/.test(from) && /^\d{4}\/\d{4}$/.test(to) && from !== to;
  const applied = preview?.already_applied || (preview && !preview.dry_run);

  return (
    <PortalPage
      title="Session rollover"
      subtitle="Move every student to the next class or level at the end of the session. Preview first; applying is recorded and can only happen once per session."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          From
          <input
            className="w-28 rounded-md border border-border bg-background px-3 py-2"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setTo(nextSession(e.target.value) ?? to);
              setPreview(null);
            }}
            placeholder="2025/2026"
          />
        </label>
        <label className="flex items-center gap-2">
          To
          <input
            className="w-28 rounded-md border border-border bg-background px-3 py-2"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPreview(null);
            }}
            placeholder="2026/2027"
          />
        </label>
        <Button size="sm" disabled={!valid || busy} onClick={doPreview}>
          {busy && !preview ? "Working…" : "Preview"}
        </Button>
      </div>

      {preview && (
        <>
          <SectionGrid>
            <StatCard label="Students" value={preview.total} />
            <StatCard label="Promoted" value={preview.promoted} />
            <StatCard label="Repeating" value={preview.repeated} />
            <StatCard label="On probation" value={preview.probation ?? 0} />
            <StatCard label="Graduating" value={preview.graduated} />
            <StatCard label="Skipped" value={preview.skipped} />
          </SectionGrid>
          {preview.promoted_without_class > 0 && (
            <p className="mt-3 text-sm text-amber-600">
              {preview.promoted_without_class} students move to a level with no class yet. Create
              the class arms first, or assign them after the rollover.
            </p>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 pr-3">Level → outcome</th>
                  <th className="py-2 pr-3">Students</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.by_level)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => {
                    const [lvl, decision] = k.split(" -> ");
                    return (
                      <tr key={k} className="border-t border-border">
                        <td className="py-2 pr-3">
                          {lvl} → {DECISION_LABEL[decision] ?? decision}
                        </td>
                        <td className="py-2 pr-3">{v}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {preview.sample.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer">
                Students not promoted (first {preview.sample.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {preview.sample.map((s) => (
                  <li key={s.student_id}>
                    {DECISION_LABEL[s.decision] ?? s.decision}: {s.from_level ?? "—"}
                    {s.cgpa != null ? ` · CGPA ${s.cgpa}` : ""}
                    {s.carry_courses ? ` · ${s.carry_courses} carry-over courses` : s.carry_units ? ` · ${s.carry_units} carry-over units` : ""}
                    {s.probation ? " · probation" : ""}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {applied ? (
            <p className="mt-6 text-sm font-medium">
              Applied
              {preview.applied_at ? ` on ${new Date(preview.applied_at).toLocaleString()}` : ""}.
              Running it again changes nothing.
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
              <span>
                Type <strong>{to}</strong> to confirm:
              </span>
              <input
                className="w-28 rounded-md border border-border bg-background px-3 py-2"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || confirmText !== to}
                onClick={doApply}
              >
                Apply rollover
              </Button>
            </div>
          )}
        </>
      )}
    </PortalPage>
  );
}
