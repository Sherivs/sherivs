import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard, EmptyCard, CardListSkeleton } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/support")({
  ssr: false,
  component: SupportPage,
});

type Complaint = {
  id: string;
  subject: string;
  description: string;
  complaint_type: string;
  status: "open" | "in_review" | "resolved" | "closed" | null;
  priority: "low" | "normal" | "high" | "critical" | null;
  super_admin_response: string | null;
  created_at: string;
  responded_at: string | null;
};

const TYPES: { value: string; label: string }[] = [
  { value: "technical_bug", label: "Technical Bug" },
  { value: "billing_issue", label: "Billing Issue" },
  { value: "feature_request", label: "Feature Request" },
  { value: "account_issue", label: "Account Issue" },
  { value: "data_issue", label: "Data Issue" },
  { value: "urgent_support", label: "Urgent Support" },
  { value: "general_feedback", label: "General Feedback" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40" },
  { value: "normal", label: "Normal", color: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
  { value: "high", label: "High", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  { value: "critical", label: "Critical", color: "bg-red-500/20 text-red-300 border-red-500/40" },
] as const;

const SLA: Record<string, string> = {
  low: "5-7 business days",
  normal: "2-3 business days",
  high: "24 hours",
  critical: "2 hours",
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
  return PRIORITIES.find((x) => x.value === p)?.color ?? PRIORITIES[1].color;
}

function typeLabel(v: string) {
  return TYPES.find((t) => t.value === v)?.label ?? v;
}

function SupportPage() {
  const { profile, school } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id ?? profile?.school_id ?? "";

  const q = useQuery<Complaint[]>({
    queryKey: ["admin-complaints", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_complaints")
        .select(
          "id, subject, description, complaint_type, status, priority, super_admin_response, created_at, responded_at",
        )
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as Complaint[];
    },
  });

  const tickets = q.data ?? [];
  const counts = useMemo(() => {
    const c = { all: tickets.length, open: 0, in_review: 0, resolved: 0, closed: 0 };
    for (const t of tickets) {
      const k = (t.status ?? "open") as keyof typeof c;
      if (k in c) (c as any)[k]++;
    }
    return c;
  }, [tickets]);

  return (
    <PortalPage
      title="Support"
      subtitle="Contact the CoreGrid team directly"
      actions={
        <NewTicketSheet
          schoolId={schoolId}
          submittedBy={profile?.id ?? ""}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-complaints"] })}
        />
      }
    >
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabTrig value="all" label="All" count={counts.all} />
          <TabTrig value="open" label="Open" count={counts.open} />
          <TabTrig value="in_review" label="In Review" count={counts.in_review} />
          <TabTrig value="resolved" label="Resolved" count={counts.resolved} />
          <TabTrig value="closed" label="Closed" count={counts.closed} />
        </TabsList>

        {(["all", "open", "in_review", "resolved", "closed"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <TicketList
              loading={q.isLoading}
              tickets={
                tab === "all" ? tickets : tickets.filter((t) => (t.status ?? "open") === tab)
              }
              emptyMsg={
                tab === "all"
                  ? "Open a ticket to report a bug, request a feature, or raise a billing question."
                  : `No ${STATUS_LABEL[tab]?.toLowerCase() ?? tab} tickets.`
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </PortalPage>
  );
}

function TabTrig({ value, label, count }: { value: string; label: string; count: number }) {
  return (
    <TabsTrigger value={value} className="gap-2">
      <span>{label}</span>
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        {count}
      </Badge>
    </TabsTrigger>
  );
}

function TicketList({
  loading,
  tickets,
  emptyMsg,
}: {
  loading: boolean;
  tickets: Complaint[];
  emptyMsg: string;
}) {
  if (loading) return <CardListSkeleton rows={4} />;
  if (tickets.length === 0) return <EmptyCard title="No tickets" body={emptyMsg} />;
  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} />
      ))}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Complaint }) {
  const [open, setOpen] = useState(false);
  const ref = ticket.id.slice(-8).toUpperCase();
  const hasResponse = !!ticket.super_admin_response;
  return (
    <GlassCard>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h3 className="font-semibold truncate">{ticket.subject}</h3>
            <span className="text-[10px] font-mono text-muted-foreground">#{ref}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={priorityColor(ticket.priority)}>
              {ticket.priority ?? "normal"}
            </Badge>
            <Badge variant="outline" className={statusColor(ticket.status)}>
              {STATUS_LABEL[ticket.status ?? "open"]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(ticket.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{typeLabel(ticket.complaint_type)}</Badge>
          <span className="text-muted-foreground line-clamp-2">
            {ticket.description.slice(0, 150)}
            {ticket.description.length > 150 ? "…" : ""}
          </span>
        </div>
        {hasResponse && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {open ? "Hide" : "View"} CoreGrid response
            </button>
            {open && (
              <blockquote className="mt-2 border-l-2 border-primary/50 bg-primary/5 px-3 py-2 rounded-r">
                <p className="text-sm whitespace-pre-wrap">{ticket.super_admin_response}</p>
                {ticket.responded_at && (
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    Responded {new Date(ticket.responded_at).toLocaleString()}
                  </div>
                )}
              </blockquote>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function NewTicketSheet({
  schoolId,
  submittedBy,
  onSaved,
}: {
  schoolId: string;
  submittedBy: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("technical_bug");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setType("technical_bug");
    setPriority("normal");
    setSubject("");
    setDescription("");
  };

  const save = useMutation({
    mutationFn: async () => {
      const subj = subject.trim();
      const desc = description.trim();
      if (!subj) throw new Error("Subject is required");
      if (subj.length > 200) throw new Error("Subject must be 200 characters or less");
      if (desc.length < 50) throw new Error("Description must be at least 50 characters");
      if (desc.length > 5000) throw new Error("Description must be 5000 characters or less");
      if (!schoolId || !submittedBy) throw new Error("Missing account context");
      const { data, error } = await supabase
        .from("platform_complaints")
        .insert({
          school_id: schoolId,
          submitted_by: submittedBy,
          subject: subj,
          description: desc,
          complaint_type: type,
          priority,
          status: "open",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: (id) => {
      const ref = id.slice(-8).toUpperCase();
      toast.success(`Ticket #${ref} submitted. We will respond within ${SLA[priority]}.`);
      setOpen(false);
      reset();
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to submit ticket"),
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" /> New ticket
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg h-dvh sm:h-auto overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Submit a support ticket</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 mt-4"
        >
          <div>
            <Label>Complaint type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Priority</Label>
            <RadioGroup
              value={priority}
              onValueChange={(v) => setPriority(v as typeof priority)}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-1"
            >
              {PRIORITIES.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
                    priority === p.value ? p.color : "border-border hover:bg-accent/40"
                  }`}
                >
                  <RadioGroupItem value={p.value} />
                  <span className="text-sm">{p.label}</span>
                </label>
              ))}
            </RadioGroup>
            {priority === "critical" && (
              <div className="mt-2 flex gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <p>
                  Critical priority is reserved for issues that completely prevent school
                  operations. Our team will respond within 2 hours.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Subject</Label>
              <span className="text-[10px] text-muted-foreground">{subject.length}/200</span>
            </div>
            <Input
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              <span
                className={`text-[10px] ${
                  description.length < 50 ? "text-amber-400" : "text-muted-foreground"
                }`}
              >
                {description.length}/5000 (min 50)
              </span>
            </div>
            <Textarea
              rows={7}
              value={description}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <Button type="submit" disabled={save.isPending} className="w-full">
            {save.isPending ? "Submitting…" : "Submit ticket"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
