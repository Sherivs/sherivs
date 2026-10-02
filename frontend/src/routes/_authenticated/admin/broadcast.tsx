/**
 * Admin / teacher broadcast composer.
 *
 * Sends the same message to many recipients in one shot — class students,
 * class parents, all parents/teachers/students in the school, or everyone.
 * Each recipient gets a normal `messages` row plus a `notifications` ping
 * so the unread badge lights up immediately.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { broadcastMessage } from "@/lib/runtime/scholar/messages-broadcast.functions";
import { sendNotificationDigests } from "@/lib/runtime/scholar/notification-digest.functions";
import { Mailbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/broadcast")({
  ssr: false,
  component: BroadcastPage,
});

type ClassRow = { id: string; name: string };

type AudienceKind =
  | "class_students"
  | "class_parents"
  | "role_parent"
  | "role_teacher"
  | "role_student"
  | "all_school";

function BroadcastPage() {
  const { school, role } = useApp();
  const schoolId = school?.id;
  const isAdmin = role === "admin" || role === "principal";
  const broadcast = useServerFn(broadcastMessage);

  const [kind, setKind] = useState<AudienceKind>(isAdmin ? "role_parent" : "class_students");
  const [classId, setClassId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const classes = useQuery<ClassRow[]>({
    queryKey: ["broadcast-classes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", schoolId!)
        .order("name");
      return (data ?? []) as ClassRow[];
    },
  });

  useEffect(() => {
    if (!classId && classes.data?.[0]) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const needsClass = kind === "class_students" || kind === "class_parents";

  const audienceOptions = useMemo(() => {
    const base: { value: AudienceKind; label: string }[] = [
      { value: "class_students", label: "Students in a class" },
      { value: "class_parents", label: "Parents of a class" },
    ];
    if (isAdmin) {
      base.push(
        { value: "role_parent", label: "All parents in school" },
        { value: "role_teacher", label: "All teachers in school" },
        { value: "role_student", label: "All students in school" },
        { value: "all_school", label: "Everyone in school" },
      );
    }
    return base;
  }, [isAdmin]);

  async function send() {
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    if (needsClass && !classId) {
      toast.error("Pick a class");
      return;
    }
    setBusy(true);
    try {
      const audience =
        kind === "class_students"
          ? { kind: "class_students" as const, class_id: classId! }
          : kind === "class_parents"
            ? { kind: "class_parents" as const, class_id: classId! }
            : kind === "all_school"
              ? { kind: "all_school" as const }
              : {
                  kind: "role" as const,
                  role:
                    kind === "role_parent"
                      ? ("parent" as const)
                      : kind === "role_teacher"
                        ? ("teacher" as const)
                        : ("student" as const),
                };
      const r = await broadcast({ data: { subject: subject.trim(), body: body.trim(), audience } });
      if (r.sent === 0) toast.message("No matching recipients — nothing sent.");
      else toast.success(`Broadcast delivered to ${r.sent} recipient(s)`);
      setSubject("");
      setBody("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Broadcast failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalPage
      title="Broadcast"
      subtitle="Send the same message to many recipients at once. Each person gets it in their inbox and as an in-app notification."
    >
      <div className="max-w-2xl uos-card p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="size-4" /> New broadcast
        </div>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Audience
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AudienceKind)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {audienceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {needsClass && (
          <label className="block">
            <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
              Class
            </span>
            <select
              value={classId ?? ""}
              onChange={(e) => setClassId(e.target.value || null)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Pick a class…
              </option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Subject
          </span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Message
          </span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={8000}
          />
        </label>

        <div className="flex justify-end">
          <Button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send broadcast"}
          </Button>
        </div>
      </div>

      {isAdmin && <DigestCard />}
    </PortalPage>
  );
}

function DigestCard() {
  const run = useServerFn(sendNotificationDigests);
  const [busy, setBusy] = useState<"daily" | "weekly" | null>(null);

  async function fire(frequency: "daily" | "weekly") {
    setBusy(frequency);
    try {
      const r = await run({ data: { frequency } });
      toast.success(
        r.sent === 0
          ? "No users had enough unread notifications to digest"
          : `Sent ${frequency} digest to ${r.sent} user(s)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Digest run failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl uos-card mt-6 p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Mailbox className="size-4" /> Notification digests
      </div>
      <p className="text-xs text-muted-foreground">
        Collapse the last 24h or 7d of unread notifications into a single summary for users who
        chose a digest cadence in their preferences. Safe to run on demand; users with the matching
        cadence get one summary entry only when they have two or more pending items.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fire("daily")}>
          {busy === "daily" ? "Sending…" : "Send daily digest now"}
        </Button>
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fire("weekly")}>
          {busy === "weekly" ? "Sending…" : "Send weekly digest now"}
        </Button>
      </div>
    </div>
  );
}
