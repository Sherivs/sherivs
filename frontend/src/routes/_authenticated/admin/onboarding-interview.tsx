/** Adaptive onboarding interview: nursery to SSS (SHERIVS-021). Answers → dry-run plan → apply. */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/scholar/rpc";
import { ensureWebsite } from "@/lib/website/bootstrap";

export const Route = createFileRoute("/_authenticated/admin/onboarding-interview")({ ssr: false, component: InterviewPage });
type Next = { remaining: string[]; next: string | null; follow_ups: string[] };
type Plan = { plan_hash: string; actions: Record<string, unknown>[]; new_items: number; existing: number };

const HINTS: Record<string, string> = {
  organisation: '{"name":"Your school","has_shifts":false,"is_group":false}',
  institution: '{"bands":["nursery","primary","jss","sss"]}',
  campuses: '{"items":[{"name":"Main campus"}]}',
  sections: '{"items":[{"name":"Nursery","campus":"Main campus","kind":"nursery","gender":"mixed","residency":"day"}],"houses":["Red House","Blue House"]}',
  shifts: '{"items":[{"name":"Morning","campus":"Main campus","kind":"morning"}]}',
  curriculum: '{"primary":"nerdc_2025_primary","jss":"nerdc_2025_jss","sss":"nerdc_2025_sss"}',
  levels: '{"items":[{"name":"Primary 1","band":"primary","ordinal":3,"arms":2,"campus":"Main campus"},{"name":"JSS 1","band":"jss","ordinal":9,"arms":3,"arm_names":["Gold","Diamond","Silver"]}]}',
  calendar: '{"terms":3}', assessment: '{"scale":"waec_a1_f9","ca_weight":40}', fees: "{}", people: "{}",
  comms: '{"consent":["core_education","messaging_sms_whatsapp"]}',
};

function InterviewPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const [session, setSession] = useState(""); const [next, setNext] = useState<Next | null>(null);
  const [text, setText] = useState(""); const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => { if (!org) return; rpc<string>("onboarding_start", { p_school: org }).then(async (s) => { setSession(s); setNext(await rpc<Next>("onboarding_next", { p_session: s })); }).catch((e) => toast.error((e as Error).message)); }, [org]);
  useEffect(() => { if (next?.next) setText(HINTS[next.next] ?? "{}"); }, [next?.next]);
  async function answer() {
    try { setNext(await rpc<Next>("onboarding_answer", { p_session: session, p_stage: next?.next, p_answer: JSON.parse(text) })); setPlan(null); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function dryRun() { try { setPlan(await rpc<Plan>("onboarding_plan", { p_session: session })); } catch (e) { toast.error((e as Error).message); } }
  async function apply() {
    try { const r = await rpc<Record<string, number>>("onboarding_apply", { p_session: session, p_plan_hash: plan?.plan_hash }); toast.success(`Workspace ready: ${r.classes_created ?? 0} classes`);
      // SHERIVS-100: first-time website from the answers (no-op when a website already exists).
      ensureWebsite(org).then((w) => { if (w === "created") toast.success("Your website is live. Edit it under Website."); }).catch(() => toast.message("Website not created automatically: open Website to build it.")); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <PortalPage title="Set up your school" subtitle="A short interview. We only ask what applies to you, show you everything before it's created, and nothing is duplicated if you run it again.">
      {next && next.next ? (
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="font-medium capitalize">Step: {next.next}</h3>
          <p className="text-xs text-muted-foreground">Still to answer: {next.remaining.join(", ")}</p>
          <textarea className="h-40 w-full rounded-md border bg-background p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} aria-label="Answer" />
          <Button onClick={answer}>Save and continue</Button>
        </div>) : (
        <div className="space-y-2 rounded-lg border p-3">
          <p>All questions answered.</p>
          <Button onClick={dryRun}>Show me what will be created</Button>
        </div>)}
      {next?.follow_ups?.length ? <ul className="mt-3 list-disc pl-5 text-sm">{next.follow_ups.map((f) => <li key={f}>{f}</li>)}</ul> : null}
      {plan && (
        <div className="mt-4 space-y-2 rounded-lg border p-3">
          <h3 className="font-medium">Dry run: {plan.new_items} new items, {plan.existing} already exist</h3>
          <ul className="max-h-72 overflow-auto text-sm">{plan.actions.map((a, i) => <li key={i}>{String(a.op)} · {String(a.name ?? a.pack ?? a.scale ?? "")}{a.arms ? ` · ${String(a.arms)} arms` : ""}{a.exists ? " (exists)" : ""}</li>)}</ul>
          <Button onClick={apply}>Create my workspace</Button>
        </div>)}
    </PortalPage>);
}
