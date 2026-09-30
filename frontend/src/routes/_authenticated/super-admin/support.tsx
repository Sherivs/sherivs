import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  StatCard,
  SectionGrid,
  EmptyCard,
  CardListSkeleton,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/super-admin/support")({
  ssr: false,
  component: SuperSupportPage,
});

type Row = {
  id: string;
  school_id: string;
  subject: string;
  description: string;
  complaint_type: string;
  status: "open" | "in_review" | "resolved" | "closed" | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  super_admin_response: string | null;
  responded_at: string | null;
  created_at: string;
  schools: { name: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_review: "In Review",
  resolved: "Resolved",
  closed: "Closed",
};

function statusColor(s: string | null | undefined) {
  if (s === "resolved") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  if (s === "in_review") return "bg-blue-500/20 text-blue-300 border-blue-500/40";
  if (s === "closed") return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
  return "bg-amber-500/20 text-amber-300 border-amber-500/40";
}

function priorityColor(p: string | null | undefined) {
  if (p === "critical") return "bg-red-500/20 text-red-300 border-red-500/40";
  if (p === "high") return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (p === "normal") return "bg-blue-500/20 text-blue-300 border-blue-500/40";
  return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
}

function SuperSupportPage() {
  const { superAdmin } = useApp();
  const qc = useQueryClient();
  const [respond, setRespond] = useState<Row | null>(null);
  const [view, setView] = useState<Row | null>(null);

  const q = useQuery<Row[]>({
    queryKey: ["super-complaints"],
    enabled: !!superAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_complaints")
        .select(
          "id, school_id, subject, description, complaint_type, status, priority, super_admin_response, responded_at, created_at, schools:school_id(name)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = q.data ?? [];
  const stats = useMemo(() => {
    let open = 0,
      high = 0,
      awaiting = 0;
    for (const r of rows) {
      const s = r.status ?? "open";
      if (s === "open" || s === "in_review") open++;
      if (r.priority === "high" || r.priority === "critical")
        if (s !== "resolved" && s !== "closed") high++;
      if (!r.super_admin_response && s !== "closed") awaiting++;
    }
    return { open, high, awaiting, total: rows.length };
  }, [rows]);

  return (
    <PortalPage title="Support tickets" subtitle="All complaints across every tenant">
      <SectionGrid>
        <StatCard label="Total tickets" value={stats.total} />
        <StatCard label="Open / In review" value={stats.open} />
        <StatCard label="High priority active" value={stats.high} />
        <StatCard label="Awaiting response" value={stats.awaiting} />
      </SectionGrid>

      <div className="mt-6">
        {q.isLoading ? (
          <CardListSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyCard
            title="No tickets yet"
            body="When schools open tickets they will appear here."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block uos-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.schools?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.complaint_type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={priorityColor(r.priority)}>
                          {r.priority ?? "normal"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate">{r.subject}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(r.status)}>
                          {STATUS_LABEL[r.status ?? "open"]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => setView(r)}>
                          <Eye className="size-3.5" />
                        </Button>
                        <Button size="sm" onClick={() => setRespond(r)}>
                          <MessageCircle className="size-3.5 mr-1" /> Respond
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {rows.map((r) => (
                <div key={r.id} className="uos-card p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{r.subject}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.schools?.name ?? "—"}
                      </div>
                    </div>
                    <Badge variant="outline" className={priorityColor(r.priority)}>
                      {r.priority ?? "normal"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant="outline" className={statusColor(r.status)}>
                      {STATUS_LABEL[r.status ?? "open"]}
                    </Badge>
                    <span className="text-muted-foreground">{r.complaint_type}</span>
                    <span className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setView(r)}
                    >
                      View
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => setRespond(r)}>
                      Respond
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <RespondSheet
        ticket={respond}
        onClose={() => setRespond(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["super-complaints"] })}
        responderId={superAdmin?.id ?? ""}
      />
      <ViewDialog ticket={view} onClose={() => setView(null)} />
    </PortalPage>
  );
}

function ViewDialog({ ticket, onClose }: { ticket: Row | null; onClose: () => void }) {
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {ticket && (
          <>
            <DialogHeader>
              <DialogTitle>{ticket.subject}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{ticket.schools?.name ?? "—"}</Badge>
                <Badge variant="outline">{ticket.complaint_type}</Badge>
                <Badge variant="outline" className={priorityColor(ticket.priority)}>
                  {ticket.priority}
                </Badge>
                <Badge variant="outline" className={statusColor(ticket.status)}>
                  {STATUS_LABEL[ticket.status ?? "open"]}
                </Badge>
              </div>
              <div className="rounded-md border border-border p-3 max-h-[50vh] overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
              </div>
              {ticket.super_admin_response && (
                <blockquote className="border-l-2 border-primary/50 bg-primary/5 px-3 py-2 rounded-r">
                  <div className="text-[10px] uppercase text-primary mb-1">Your response</div>
                  <p className="text-sm whitespace-pre-wrap">{ticket.super_admin_response}</p>
                </blockquote>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RespondSheet({
  ticket,
  onClose,
  onSaved,
  responderId,
}: {
  ticket: Row | null;
  onClose: () => void;
  onSaved: () => void;
  responderId: string;
}) {
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<"in_review" | "resolved" | "closed">("in_review");

  // Sync on open
  useMemo(() => {
    if (ticket) {
      setResponse(ticket.super_admin_response ?? "");
      const s = ticket.status ?? "open";
      setStatus(s === "open" ? "in_review" : (s as "in_review" | "resolved" | "closed"));
    }
  }, [ticket]);

  const save = useMutation({
    mutationFn: async () => {
      if (!ticket) return;
      if (response.trim().length < 5) throw new Error("Write a response before saving");
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("platform_complaints")
        .update({
          super_admin_response: response.trim(),
          status,
          responded_at: now,
          ...(responderId ? { responded_by: responderId } : {}),
          ...(status === "resolved" ? { resolved_at: now } : {}),
        })
        .eq("id", ticket.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Response sent");
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <Sheet open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl h-dvh sm:h-auto overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Respond to ticket</SheetTitle>
        </SheetHeader>
        {ticket && (
          <form
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                {ticket.schools?.name ?? "—"} · #{ticket.id.slice(-8).toUpperCase()}
              </div>
              <h3 className="font-semibold">{ticket.subject}</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className={priorityColor(ticket.priority)}>
                  {ticket.priority}
                </Badge>
                <Badge variant="outline">{ticket.complaint_type}</Badge>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 max-h-48 overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            </div>

            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Response</Label>
              <Textarea
                rows={7}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Write a clear response for the school admin…"
                required
              />
            </div>

            <Button type="submit" disabled={save.isPending} className="w-full">
              {save.isPending ? "Sending…" : "Send response"}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
