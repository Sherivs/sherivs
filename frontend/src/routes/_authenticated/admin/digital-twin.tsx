/**
 * Admin: Digital Twin console.
 * Configure the school's AI voice twin (name, voice, personality, knowledge,
 * trigger rules) and place / review outbound calls. Calls fall back to a
 * logged "stub" status when Twilio is not connected.
 */
import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { saveTwinConfig, placeTwinCall } from "@/lib/runtime/scholar/digital-twin.functions";

export const Route = createFileRoute("/_authenticated/admin/digital-twin")({
  ssr: false,
  component: DigitalTwinPage,
});

type Config = {
  id: string;
  twin_name: string;
  twin_voice: string;
  twin_personality: string;
  school_knowledge: Record<string, any>;
  trigger_rules: Record<string, any>;
  is_active: boolean;
};

type CallRow = {
  id: string;
  call_type: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  call_status: string;
  call_outcome: string | null;
  call_summary: string | null;
  twilio_call_sid: string | null;
  created_at: string;
};

const VOICES = ["alice", "man", "woman", "Polly.Joanna", "Polly.Matthew", "Polly.Amy"];

function DigitalTwinPage() {
  const { school } = useApp();
  const qc = useQueryClient();
  const sid = school?.id;

  const cfgQ = useQuery<Config | null>({
    queryKey: ["twin-config", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("digital_twin_config")
        .select(
          "id, twin_name, twin_voice, twin_personality, school_knowledge, trigger_rules, is_active",
        )
        .eq("school_id", sid!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Config | null;
    },
  });

  const callsQ = useQuery<CallRow[]>({
    queryKey: ["twin-calls", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("digital_twin_calls")
        .select(
          "id, call_type, recipient_name, recipient_phone, call_status, call_outcome, call_summary, twilio_call_sid, created_at",
        )
        .eq("school_id", sid!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as CallRow[];
    },
  });

  const saveFn = useServerFn(saveTwinConfig);
  const callFn = useServerFn(placeTwinCall);

  const [form, setForm] = useState<{
    twin_name: string;
    twin_voice: string;
    twin_personality: string;
    knowledge: string;
    triggers: string;
    is_active: boolean;
  } | null>(null);

  const initial = useMemo(() => {
    const c = cfgQ.data;
    return {
      twin_name: c?.twin_name ?? `${school?.name ?? "School"} Assistant`,
      twin_voice: c?.twin_voice ?? "alice",
      twin_personality:
        c?.twin_personality ??
        "Warm, professional, concise. Speaks to parents respectfully and never shares grades over the phone.",
      knowledge: JSON.stringify(c?.school_knowledge ?? {}, null, 2),
      triggers: JSON.stringify(c?.trigger_rules ?? {}, null, 2),
      is_active: c?.is_active ?? true,
    };
  }, [cfgQ.data, school?.name]);

  const value = form ?? initial;

  const saveM = useMutation({
    mutationFn: async () => {
      let knowledge: Record<string, any> = {};
      let triggers: Record<string, any> = {};
      try {
        knowledge = JSON.parse(value.knowledge || "{}");
      } catch {
        throw new Error("Knowledge must be valid JSON");
      }
      try {
        triggers = JSON.parse(value.triggers || "{}");
      } catch {
        throw new Error("Trigger rules must be valid JSON");
      }
      return saveFn({
        data: {
          twin_name: value.twin_name,
          twin_voice: value.twin_voice,
          twin_personality: value.twin_personality,
          school_knowledge: knowledge,
          trigger_rules: triggers,
          is_active: value.is_active,
        },
      });
    },
    onSuccess: () => {
      toast.success("Twin saved");
      qc.invalidateQueries({ queryKey: ["twin-config", sid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Test call form ----
  const [call, setCall] = useState({
    call_type: "announcement" as "attendance_alert" | "fees_reminder" | "announcement" | "custom",
    recipient_name: "",
    recipient_phone: "",
    recipient_role: "parent" as "parent" | "teacher" | "student" | "other",
    script: "",
  });

  const callM = useMutation({
    mutationFn: () =>
      callFn({
        data: {
          call_type: call.call_type,
          recipient_name: call.recipient_name,
          recipient_phone: call.recipient_phone,
          recipient_role: call.recipient_role,
          script: call.script,
        },
      }),
    onSuccess: (r: any) => {
      if (r?.status === "stub") toast.warning(r.message ?? "Logged as stub");
      else toast.success(`Call queued (SID ${r?.sid ?? "—"})`);
      setCall((c) => ({ ...c, recipient_name: "", recipient_phone: "", script: "" }));
      qc.invalidateQueries({ queryKey: ["twin-calls", sid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PortalPage
      title="Digital Twin"
      subtitle="An AI voice assistant that places real outbound calls on behalf of the school."
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Config ---------- */}
        <section className="rounded-xl border border-border bg-card/60 p-5">
          <h2 className="mb-4 text-lg font-semibold">Twin configuration</h2>
          <div className="space-y-3 text-sm">
            <Field label="Twin name">
              <input
                className="input w-full"
                value={value.twin_name}
                onChange={(e) => setForm({ ...value, twin_name: e.target.value })}
              />
            </Field>
            <Field label="Voice">
              <select
                className="input w-full"
                value={value.twin_voice}
                onChange={(e) => setForm({ ...value, twin_voice: e.target.value })}
              >
                {VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Personality / tone">
              <textarea
                className="input min-h-[100px] w-full"
                value={value.twin_personality}
                onChange={(e) => setForm({ ...value, twin_personality: e.target.value })}
              />
            </Field>
            <Field label='School knowledge (JSON, e.g. {"hours":"8am–3pm"})'>
              <textarea
                className="input min-h-[120px] w-full font-mono text-xs"
                value={value.knowledge}
                onChange={(e) => setForm({ ...value, knowledge: e.target.value })}
              />
            </Field>
            <Field label="Trigger rules (JSON)">
              <textarea
                className="input min-h-[100px] w-full font-mono text-xs"
                value={value.triggers}
                onChange={(e) => setForm({ ...value, triggers: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.is_active}
                onChange={(e) => setForm({ ...value, is_active: e.target.checked })}
              />
              <span>Active</span>
            </label>
            <button
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {saveM.isPending ? "Saving…" : "Save twin"}
            </button>
          </div>
        </section>

        {/* ---------- Place a call ---------- */}
        <section className="rounded-xl border border-border bg-card/60 p-5">
          <h2 className="mb-1 text-lg font-semibold">Place a call</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Twilio not connected? The call is logged as a stub so you can preview the flow.
          </p>
          <div className="space-y-3 text-sm">
            <Field label="Call type">
              <select
                className="input w-full"
                value={call.call_type}
                onChange={(e) =>
                  setCall({ ...call, call_type: e.target.value as typeof call.call_type })
                }
              >
                <option value="announcement">Announcement</option>
                <option value="attendance_alert">Attendance alert</option>
                <option value="fees_reminder">Fees reminder</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Recipient name">
              <input
                className="input w-full"
                value={call.recipient_name}
                onChange={(e) => setCall({ ...call, recipient_name: e.target.value })}
              />
            </Field>
            <Field label="Phone (E.164, e.g. +2348012345678)">
              <input
                className="input w-full"
                value={call.recipient_phone}
                onChange={(e) => setCall({ ...call, recipient_phone: e.target.value })}
              />
            </Field>
            <Field label="Recipient role">
              <select
                className="input w-full"
                value={call.recipient_role}
                onChange={(e) =>
                  setCall({ ...call, recipient_role: e.target.value as typeof call.recipient_role })
                }
              >
                <option value="parent">Parent</option>
                <option value="teacher">Teacher</option>
                <option value="student">Student</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Script (what the twin will say)">
              <textarea
                className="input min-h-[140px] w-full"
                value={call.script}
                onChange={(e) => setCall({ ...call, script: e.target.value })}
                placeholder="Hello, this is a friendly reminder from…"
              />
            </Field>
            <button
              onClick={() => callM.mutate()}
              disabled={
                callM.isPending || !call.recipient_name || !call.recipient_phone || !call.script
              }
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {callM.isPending ? "Placing…" : "Place call"}
            </button>
          </div>
        </section>
      </div>

      {/* ---------- Recent calls ---------- */}
      <section className="mt-8 overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-muted/20 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Recent calls
          </h2>
        </div>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Outcome / SID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(callsQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {callsQ.isLoading ? "Loading…" : "No calls yet."}
                  </td>
                </tr>
              )}
              {(callsQ.data ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 capitalize">{c.call_type?.replace(/_/g, " ") ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div>{c.recipient_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.recipient_phone ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusClass(c.call_status)}>{c.call_status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.twilio_call_sid ?? c.call_outcome ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PortalPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function statusClass(s: string) {
  const base = "rounded-full px-2 py-0.5 text-xs font-semibold";
  if (s === "queued" || s === "in-progress") return `${base} bg-blue-500/10 text-blue-300`;
  if (s === "completed") return `${base} bg-emerald-500/10 text-emerald-300`;
  if (s === "failed") return `${base} bg-red-500/10 text-red-300`;
  if (s === "stub") return `${base} bg-amber-500/10 text-amber-300`;
  return `${base} bg-muted text-muted-foreground`;
}
