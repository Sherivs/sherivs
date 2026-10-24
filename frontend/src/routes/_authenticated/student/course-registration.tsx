/** Course registration: prerequisites, carry-overs first, unit limits (SHERIVS-023). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/student/course-registration")({ ssr: false, component: CourseReg });
const MSG: Record<string, string> = {
  registration_closed: "Registration is closed for this semester.", prerequisite_missing: "You have not passed the prerequisite", wrong_semester: "That course is not offered this semester.",
  register_carryovers_first: "Register your carry-over courses first", unit_limit: "This would take you over the maximum units.",
};

function CourseReg() {
  const qc = useQueryClient();
  const [session, setSession] = useState("2026/2027"); const [semester, setSemester] = useState("First");
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => rows<{ id: string; code: string; title: string; credit_units: number; level: string; semester: string }>(sdb.from("courses").select("id,code,title,credit_units,level,semester").order("code")) });
  const mine = useQuery({ queryKey: ["my-regs", session], queryFn: () => rows<{ id: string; course_id: string; status: string; is_carryover: boolean }>(sdb.from("course_registrations").select("id,course_id,status,is_carryover").eq("session", session)) });
  async function reg(id: string) {
    type Res = { ok: boolean; error?: string; missing?: string; carryovers?: string; units?: number; below_minimum?: boolean };
    const r: Res = await rpc<Res>("course_register", { p_course: id, p_session: session, p_semester: semester }).catch((e): Res => ({ ok: false, error: (e as Error).message }));
    if (r.ok) toast.success(`Registered. ${r.units} units${r.below_minimum ? " (still below the minimum)" : ""}`);
    else toast.error(`${MSG[r.error ?? ""] ?? r.error}${r.missing ? `: ${r.missing}` : ""}${r.carryovers ? `: ${r.carryovers}` : ""}`);
    await qc.invalidateQueries();
  }
  async function drop(id: string) { try { await rpc("course_drop", { p_registration: id }); toast.success("Dropped"); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  const regBy = new Map((mine.data ?? []).map((r) => [r.course_id, r]));
  return (
    <PortalPage title="Course registration" subtitle="Your adviser approves each course after you register.">
      <div className="mb-3 flex gap-2"><Input value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session" /><Input value={semester} onChange={(e) => setSemester(e.target.value)} aria-label="Semester" /></div>
      <table className="w-full text-sm"><thead><tr className="text-left"><th>Code</th><th>Title</th><th>Units</th><th>Status</th><th /></tr></thead>
        <tbody>{(courses.data ?? []).filter((c) => !c.semester || c.semester === semester).map((c) => { const r = regBy.get(c.id); return (
          <tr key={c.id} className="border-t"><td>{c.code}</td><td>{c.title}</td><td>{c.credit_units}</td><td>{r ? `${r.status}${r.is_carryover ? " (carry-over)" : ""}` : ""}</td>
            <td>{!r || r.status === "dropped" ? <Button size="sm" onClick={() => reg(c.id)}>Register</Button> : r.status === "pending" && !r.is_carryover ? <Button size="sm" variant="outline" onClick={() => drop(r.id)}>Drop</Button> : null}</td></tr>); })}</tbody></table>
    </PortalPage>);
}
