/** School side of the group console (SHERIVS-B06): accept or decline joining a proprietor's group, or leave it. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/school-group")({ ssr: false, component: SchoolGroupPage });

type Reqs = { school_id: string; membership: { group_id: string; group: string; since: string } | null; pending: { id: string; group: string; requested_at: string }[] };

function SchoolGroupPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["school-group"], queryFn: () => rpc<Reqs>("school_group_requests") });
  const go = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries({ queryKey: ["school-group"] }); } catch (e) { toast.error((e as Error).message); }
  };
  const d = q.data;
  return (
    <PortalPage title="School group" subtitle="A proprietor's group sees only totals for member schools (never learner records). Joining needs your approval with MFA.">
      {d?.membership ? (
        <div className="rounded-lg border p-3 text-sm">
          Member of <span className="font-medium">{d.membership.group}</span> since {d.membership.since.slice(0, 10)}.
          {<Button size="sm" variant="ghost" className="ml-2" onClick={() => { if (confirm("Leave this group?")) void go("group_school_leave", { p_school: d.school_id }, "Left the group"); }}>Leave group</Button>}
        </div>
      ) : <p className="text-sm text-muted-foreground">Your school is not in a group.</p>}
      <h2 className="mt-4 font-semibold">Requests</h2>
      <ul className="mt-2 space-y-2">
        {(d?.pending ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>{r.group} wants to add your school ({r.requested_at.slice(0, 10)})</span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => go("school_group_decide", { p_request: r.id, p_accept: true }, "Joined the group")}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={() => go("school_group_decide", { p_request: r.id, p_accept: false }, "Declined")}>Decline</Button>
            </span>
          </li>))}
        {(d?.pending ?? []).length === 0 && <li className="text-sm text-muted-foreground">No pending requests.</li>}
      </ul>
    </PortalPage>
  );
}
