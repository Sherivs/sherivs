/** Student CBT: works through flaky connections. Answers are cached locally and synced; the server enforces the deadline + grace. */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";
import { cbtCache } from "@/lib/scholar/offline-queue";

export const Route = createFileRoute("/_authenticated/student/cbt")({ ssr: false, component: CbtPage });
type Q = { id: string; stem: string; options: string[]; marks: number };
type Start = { attempt_id: string; deadline: string; grace_minutes: number; questions: Q[]; status: string };

function CbtPage() {
  const tests = useQuery({ queryKey: ["cbt-tests"], queryFn: () => rows<{ id: string; title: string; closes_at: string }>(sdb.from("cbt_tests").select("id,title,closes_at").order("opens_at")) });
  const [s, setS] = useState<Start | null>(null);
  const cache = useMemo(() => (s ? cbtCache(s.attempt_id) : null), [s]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => { const up = () => setOnline(true), down = () => setOnline(false); window.addEventListener("online", up); window.addEventListener("offline", down); return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); }; }, []);
  useEffect(() => { if (!cache) return; setAnswers(cache.read().answers); const t = setInterval(() => { if (navigator.onLine) void cache.sync().catch(() => {}); }, 15000); return () => clearInterval(t); }, [cache]);
  async function start(id: string) { try { setS(await rpc<Start>("cbt_start", { p_test: id })); } catch (e) { toast.error((e as Error).message); } }
  async function submit() { if (!cache) return; try { const r = await cache.submit() as { score: number; max: number }; toast.success(`Submitted: ${r.score}/${r.max}`); setS(null); } catch (e) { toast.error(`${(e as Error).message}. Your answers are saved on this device; try again when online.`); } }
  return (
    <PortalPage title="Computer-based tests" subtitle={online ? "Online" : "Offline: answers are saved on this device and will sync"}>
      {!s && <ul className="space-y-2">{(tests.data ?? []).map((t) => <li key={t.id} className="flex items-center justify-between rounded border p-2"><span>{t.title}</span><Button onClick={() => start(t.id)}>Start</Button></li>)}</ul>}
      {s && (
        <div className="space-y-4">
          <p className="text-sm">Deadline {new Date(s.deadline).toLocaleTimeString()} (+{s.grace_minutes} min to reconnect)</p>
          {s.questions.map((q, i) => (
            <fieldset key={q.id} className="rounded border p-3"><legend className="px-1 font-medium">{i + 1}. {q.stem}</legend>
              {q.options.map((o, j) => (
                <label key={j} className="block text-sm"><input type="radio" name={q.id} checked={answers[q.id] === j}
                  onChange={() => { const st = cache!.answer(q.id, j); setAnswers({ ...st.answers }); }} /> {o}</label>))}
            </fieldset>))}
          <Button onClick={submit}>Submit</Button>
        </div>)}
    </PortalPage>);
}
