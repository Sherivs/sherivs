/** Consent for my children (SHERIVS-B04). Guardians (and adult learners for themselves) choose optional uses. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/scholar/rpc";
import { CONSENT_PURPOSES, type Learner } from "@/lib/safeguards";

export const Route = createFileRoute("/_authenticated/consent")({ ssr: false, component: ConsentPage });

function ConsentPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["consent-learners"], queryFn: () => rpc<Learner[]>("consent_my_learners") });
  const set = async (s: string, p: string, grant: boolean) => {
    try { await rpc("consent_set", { p_student: s, p_purpose: p, p_grant: grant }); toast.success(grant ? "Consent given" : "Consent withdrawn"); await qc.invalidateQueries({ queryKey: ["consent-learners"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <PortalPage title="Consent" subtitle="Choose which optional uses of your child's data the school may make. You can change this at any time.">
      {(q.data ?? []).length === 0 && !q.isLoading && <p className="text-sm text-muted-foreground">No learners are linked to your account.</p>}
      {(q.data ?? []).map((l) => (
        <section key={l.student_id} className="mt-4 rounded-lg border p-4">
          <h2 className="font-semibold">{l.name}{l.self ? " (you)" : ""}</h2>
          <ul className="mt-2 space-y-3">
            {CONSENT_PURPOSES.map(([k, label, desc]) => {
              const st = l.purposes[k];
              return (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div><div className="font-medium">{label}</div><div className="text-muted-foreground">{desc}</div></div>
                  <div className="flex items-center gap-2">
                    <span className={st === "granted" ? "text-emerald-600" : "text-muted-foreground"}>{st === "granted" ? "Allowed" : st === "withdrawn" ? "Not allowed" : "Not answered"}</span>
                    {st === "granted"
                      ? <Button size="sm" variant="outline" onClick={() => set(l.student_id, k, false)}>Withdraw</Button>
                      : <Button size="sm" onClick={() => set(l.student_id, k, true)}>Allow</Button>}
                  </div>
                </li>);
            })}
          </ul>
        </section>
      ))}
    </PortalPage>
  );
}
