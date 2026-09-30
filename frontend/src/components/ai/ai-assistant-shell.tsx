import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAIConversationHistory, useAIConversationStore } from "@/hooks/use-ai-conversations";
import { Bot, History as HistoryIcon, Plus, Send, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Button } from "@/components/ui/button";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type AIMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type QuickPrompt = { label: string; prompt: string };

/**
 * Scope narrows every Supabase query the assistant runs so each portal only
 * ever reads data the signed-in user is allowed to see. school_id is always
 * applied on top of this.
 */
export type AIScope = {
  /** Restrict class-bound queries (teacher portal). */
  classIds?: string[];
  /** Restrict student-bound queries (parent / student portal). */
  studentIds?: string[];
  /** Restrict teacher-bound queries (teacher portal). */
  teacherId?: string;
  /** Friendly label for the subject of the answers, e.g. "your child". */
  subjectLabel?: string;
};

export type AIAssistantShellProps = {
  portalName: string;
  /** Display name for the assistant, e.g. "School Hermes". */
  assistantName: string;
  systemContext: string;
  quickPrompts: QuickPrompt[];
  userId: string;
  schoolId: string;
  scope?: AIScope;
  isLoadingScope?: boolean;
  /** Pre-fills the composer (e.g. from a dashboard quick-prompt link). */
  initialPrompt?: string;
};

const MAX_STORED = 50;

/* -------------------------------------------------------------------------- */
/*  Tiny markdown renderer (bold, italics, inline code, bullets, headings)      */
/* -------------------------------------------------------------------------- */

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => content.split("\n"), [content]);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul-${key}`} className="my-1.5 list-disc space-y-1 pl-4">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  blocks.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*•]\s+/, ""));
      return;
    }
    flush(String(idx));
    if (!line.trim()) return;
    if (/^###\s+/.test(line)) {
      out.push(
        <h4 key={idx} className="mt-2 font-display text-sm font-semibold">
          {renderInline(line.replace(/^###\s+/, ""), `h${idx}`)}
        </h4>,
      );
    } else if (/^##\s+/.test(line)) {
      out.push(
        <h3 key={idx} className="mt-2 font-display text-base font-semibold">
          {renderInline(line.replace(/^##\s+/, ""), `h${idx}`)}
        </h3>,
      );
    } else {
      out.push(
        <p key={idx} className="my-1">
          {renderInline(line, `p${idx}`)}
        </p>,
      );
    }
  });
  flush("end");

  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{out}</div>;
}

/* -------------------------------------------------------------------------- */
/*  Data-backed responder                                                      */
/* -------------------------------------------------------------------------- */

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const isoDate = (d: Date) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

async function answer(
  question: string,
  schoolId: string,
  scope: AIScope,
  systemContext: string,
): Promise<string> {
  const q = question.toLowerCase();
  const who = scope.subjectLabel ?? "your school";

  /* ---------------------------------- attendance --------------------------- */
  if (q.includes("attendance") || q.includes("present") || q.includes("absent")) {
    let req = supabase
      .from("attendance")
      .select("status, date, student_id")
      .eq("school_id", schoolId)
      .gte("date", isoDate(daysAgo(30)));
    if (scope.classIds?.length) req = req.in("class_id", scope.classIds);
    if (scope.studentIds?.length) req = req.in("student_id", scope.studentIds);
    const { data, error } = await req;
    if (error) throw error;
    const rows = data ?? [];
    if (!rows.length)
      return `I could not find any attendance records for ${who} in the last 30 days.`;
    const ok = rows.filter((r) => r.status === "present" || r.status === "late").length;
    const late = rows.filter((r) => r.status === "late").length;
    const today = isoDate(new Date());
    const todayRows = rows.filter((r) => String(r.date).slice(0, 10) === today);
    const todayOk = todayRows.filter((r) => r.status === "present" || r.status === "late").length;
    return [
      `## Attendance summary`,
      `Based on **${rows.length}** records over the last 30 days for ${who}:`,
      `- Overall attendance rate: **${pct(ok, rows.length)}%**`,
      `- Late arrivals: **${late}**`,
      todayRows.length
        ? `- Today: **${pct(todayOk, todayRows.length)}%** present (${todayOk} of ${todayRows.length})`
        : `- No attendance has been marked yet today`,
      pct(ok, rows.length) < 75
        ? `\nAttendance is below the healthy 75% threshold — a follow-up is recommended.`
        : `\nAttendance is healthy. Keep it up.`,
    ].join("\n");
  }

  /* ------------------------------- fees / payments ------------------------- */
  if (
    q.includes("fee") ||
    q.includes("payment") ||
    q.includes("owing") ||
    q.includes("outstanding")
  ) {
    let req = supabase
      .from("fees")
      .select("amount, paid_amount, status, due_date, fee_type, term")
      .eq("school_id", schoolId);
    if (scope.studentIds?.length) req = req.in("student_id", scope.studentIds);
    const { data, error } = await req;
    if (error) throw error;
    const rows = data ?? [];
    if (!rows.length) return `There are no fee records on file for ${who} yet.`;
    let billed = 0,
      collected = 0,
      overdue = 0,
      overdueCount = 0;
    const cutoff = new Date();
    rows.forEach((f) => {
      const a = Number(f.amount ?? 0),
        p = Number(f.paid_amount ?? 0);
      billed += a;
      collected += p;
      if (f.status !== "paid" && f.due_date && new Date(f.due_date) < cutoff) {
        overdue += Math.max(0, a - p);
        overdueCount += 1;
      }
    });
    return [
      `## Fee position`,
      `- Total billed: **${naira(billed)}**`,
      `- Collected: **${naira(collected)}** (${pct(collected, billed)}%)`,
      `- Outstanding: **${naira(Math.max(0, billed - collected))}**`,
      `- Overdue invoices: **${overdueCount}** worth ${naira(overdue)}`,
      pct(collected, billed) >= 80
        ? `\nCollection is strong this period.`
        : `\nCollection is lagging — consider a reminder to the affected families.`,
    ].join("\n");
  }

  /* --------------------------------- students ------------------------------ */
  if (
    q.includes("student") ||
    q.includes("child") ||
    q.includes("pupil") ||
    q.includes("at-risk") ||
    q.includes("at risk")
  ) {
    let req = supabase
      .from("students")
      .select("id, admission_number, is_active, enrollment_date, class_id")
      .eq("school_id", schoolId)
      .order("enrollment_date", { ascending: false })
      .limit(500);
    if (scope.classIds?.length) req = req.in("class_id", scope.classIds);
    if (scope.studentIds?.length) req = req.in("id", scope.studentIds);
    const { data, error } = await req;
    if (error) throw error;
    const rows = data ?? [];
    if (!rows.length) return `I could not find any student records in scope for ${who}.`;
    const active = rows.filter((s) => s.is_active).length;
    const recent = rows.slice(0, 5);
    return [
      `## Students in scope`,
      `- Records visible to you: **${rows.length}**`,
      `- Currently active: **${active}**`,
      ``,
      `### Most recent enrolments`,
      ...recent.map(
        (s) =>
          `- ${s.admission_number ?? "No admission number"} — enrolled ${s.enrollment_date ? new Date(s.enrollment_date).toLocaleDateString() : "date unknown"}`,
      ),
    ].join("\n");
  }

  /* --------------------------- schedule / timetable ------------------------ */
  if (
    q.includes("schedule") ||
    q.includes("timetable") ||
    q.includes("lesson") ||
    q.includes("period")
  ) {
    let req = supabase
      .from("timetable_slots")
      .select("day_of_week, period_number, subject, start_time, end_time, room, is_break")
      .eq("school_id", schoolId)
      .order("period_number", { ascending: true })
      .limit(40);
    if (scope.teacherId) req = req.eq("teacher_id", scope.teacherId);
    const { data, error } = await req;
    if (error) throw error;
    const rows = (data ?? []).filter((r) => !r.is_break);
    if (!rows.length) return `No timetable slots are published for ${who} yet.`;
    const dayName = new Date().toLocaleDateString(undefined, { weekday: "long" });
    const todayRows = rows.filter(
      (r) => String(r.day_of_week).toLowerCase() === dayName.toLowerCase(),
    );
    const show = (todayRows.length ? todayRows : rows).slice(0, 8);
    return [
      `## ${todayRows.length ? `${dayName}'s schedule` : "Upcoming schedule"}`,
      ...show.map(
        (r) =>
          `- Period ${r.period_number}: **${r.subject}** ${r.start_time?.slice(0, 5)}–${r.end_time?.slice(0, 5)}${r.room ? ` · ${r.room}` : ""}`,
      ),
      ``,
      `${rows.length} slots are scheduled in total.`,
    ].join("\n");
  }

  /* ------------------------------ grades / results ------------------------- */
  if (
    q.includes("grade") ||
    q.includes("result") ||
    q.includes("score") ||
    q.includes("perform") ||
    q.includes("quiz") ||
    q.includes("exam")
  ) {
    let req = supabase
      .from("grades")
      .select("subject, total_score, grade, term, student_id")
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .limit(500);
    if (scope.classIds?.length) req = req.in("class_id", scope.classIds);
    if (scope.studentIds?.length) req = req.in("student_id", scope.studentIds);
    const { data, error } = await req;
    if (error) throw error;
    const rows = (data ?? []).filter((g) => g.total_score !== null);
    if (!rows.length) return `No published results are available for ${who} yet.`;
    const avg = rows.reduce((s, g) => s + Number(g.total_score ?? 0), 0) / rows.length;
    const bySubject: Record<string, { sum: number; n: number }> = {};
    rows.forEach((g) => {
      const b = bySubject[g.subject] ?? { sum: 0, n: 0 };
      b.sum += Number(g.total_score ?? 0);
      b.n += 1;
      bySubject[g.subject] = b;
    });
    const ranked = Object.entries(bySubject)
      .map(([subject, v]) => ({ subject, avg: v.sum / v.n }))
      .sort((a, b) => b.avg - a.avg);
    const failing = rows.filter((g) => Number(g.total_score ?? 0) < 40).length;
    return [
      `## Academic performance`,
      `- Published results analysed: **${rows.length}**`,
      `- Average score: **${avg.toFixed(1)}%**`,
      `- Results below 40%: **${failing}**`,
      ``,
      `### Strongest subjects`,
      ...ranked.slice(0, 3).map((r) => `- ${r.subject}: **${r.avg.toFixed(1)}%**`),
      ``,
      `### Needs attention`,
      ...ranked
        .slice(-3)
        .reverse()
        .map((r) => `- ${r.subject}: **${r.avg.toFixed(1)}%**`),
    ].join("\n");
  }

  /* ---------------------------------- buses -------------------------------- */
  if (q.includes("bus") || q.includes("transport") || q.includes("driver")) {
    const { data, error } = await supabase
      .from("transport_buses")
      .select("bus_number, route_name, current_status, last_location_update, is_active")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .limit(10);
    if (error) throw error;
    const rows = data ?? [];
    if (!rows.length) return `No active buses are configured for ${who}.`;
    return [
      `## Transport status`,
      ...rows.map((b) => {
        const ts = b.last_location_update ? new Date(b.last_location_update) : null;
        const stale = !ts || Date.now() - ts.getTime() > 2 * 3600_000;
        return `- **${b.bus_number}**${b.route_name ? ` (${b.route_name})` : ""} — ${b.current_status ?? "status unknown"}, last ping ${ts ? ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never"}${stale ? " ⚠️" : " ✅"}`;
      }),
    ].join("\n");
  }

  /* --------------------------------- default -------------------------------- */
  return [
    `I am analysing ${who} data now.`,
    ``,
    systemContext,
    ``,
    `Try asking me about **attendance**, **fees**, **students**, **timetable**, **grades**, or **buses** and I will pull live figures for you.`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function AIAssistantShell({
  portalName,
  assistantName,
  systemContext,
  quickPrompts,
  userId,
  schoolId,
  scope,
  isLoadingScope = false,
  initialPrompt,
}: AIAssistantShellProps) {
  const { school } = useApp();
  const storageKey = `vibeora_ai_${userId}_${portalName}`;

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);

  /* -------------------------------- persistence -------------------------- */
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !userId) return;
    hydrated.current = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { conversationId?: string; messages?: AIMessage[] };
        setMessages(Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_STORED) : []);
        setConversationId(parsed.conversationId || crypto.randomUUID());
      } else {
        setMessages([]);
        setConversationId(crypto.randomUUID());
      }
    } catch {
      setMessages([]);
      setConversationId(crypto.randomUUID());
    }
    hydrated.current = true;
  }, [storageKey, userId]);

  useEffect(() => {
    if (typeof window === "undefined" || !hydrated.current || !conversationId) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ conversationId, messages: messages.slice(-MAX_STORED) }),
      );
    } catch {
      /* storage full or unavailable — chat still works in-session */
    }
  }, [messages, conversationId, storageKey]);

  /* --------------------------- database persistence ---------------------- */
  const { saveConversation, logInteraction } = useAIConversationStore({
    userId: userId ?? null,
    schoolId: schoolId ?? null,
    portal: portalName,
  });
  const history = useAIConversationHistory({
    userId: userId ?? null,
    schoolId: schoolId ?? null,
    portal: portalName,
  });
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadConversation = (conv: { id: string; messages: AIMessage[] }) => {
    setConversationId(conv.id);
    setMessages(conv.messages.slice(-MAX_STORED));
    setHistoryOpen(false);
    toast.success("Conversation restored");
  };

  /* ---------------------------------- scroll ----------------------------- */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming, messages.length]);

  /* ------------------------------ auto-resize ---------------------------- */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [input]);

  /* --------------------------------- send -------------------------------- */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || !schoolId) return;
    setInput("");
    setIsStreaming(true);
    const started = performance.now();
    const withUser = [
      ...messages,
      { role: "user" as const, content: text, timestamp: Date.now() },
    ].slice(-MAX_STORED);
    setMessages(withUser);
    try {
      const reply = await answer(text, schoolId, scope ?? {}, systemContext);
      // brief pause so the typing indicator reads as a response, not a flash
      await new Promise((r) => setTimeout(r, 350));
      const withReply = [
        ...withUser,
        { role: "assistant" as const, content: reply, timestamp: Date.now() },
      ].slice(-MAX_STORED);
      setMessages(withReply);
      // Persistence is best-effort: the chat must keep working if it fails.
      void saveConversation(conversationId, withReply).catch(() => {});
      void logInteraction({
        prompt: text,
        response: reply,
        latencyMs: performance.now() - started,
        success: true,
      }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(`Assistant could not answer: ${msg}`);
      setMessages((prev) =>
        [
          ...prev,
          {
            role: "assistant" as const,
            content: `I could not reach your school data just now. Please try again.`,
            timestamp: Date.now(),
          },
        ].slice(-MAX_STORED),
      );
      void logInteraction({
        prompt: text,
        response: msg,
        latencyMs: performance.now() - started,
        success: false,
      }).catch(() => {});
    } finally {
      setIsStreaming(false);
    }
  }, [
    input,
    isStreaming,
    schoolId,
    scope,
    systemContext,
    messages,
    conversationId,
    saveConversation,
    logInteraction,
  ]);

  const newChat = () => {
    setMessages([]);
    setInput("");
    setConversationId(crypto.randomUUID());
    toast.success("Started a new conversation");
    textareaRef.current?.focus();
  };

  const disabled = !input.trim() || isStreaming || isLoadingScope;

  return (
    <div className="uos-card flex h-[calc(100vh-14rem)] min-h-[520px] flex-col overflow-hidden p-0">
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-sm font-semibold sm:text-base">
              {assistantName}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {school?.name ?? "Your school"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
          >
            <HistoryIcon className="mr-1.5 h-3.5 w-3.5" />
            History
            {(history.data?.length ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
                {history.data!.length}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={newChat}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New Chat
          </Button>
        </div>
      </header>

      {/* Conversation history */}
      {historyOpen && (
        <div className="max-h-56 overflow-y-auto border-b border-border bg-muted/10 px-4 py-3 sm:px-5">
          {history.isLoading && (
            <p className="text-xs text-muted-foreground">Loading your past chats…</p>
          )}
          {history.isError && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Could not load your past chats.</p>
              <Button variant="outline" size="sm" onClick={() => void history.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {!history.isLoading && !history.isError && (history.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">
              No saved conversations yet — your chats are saved automatically.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {(history.data ?? []).map((conv) => (
              <li key={conv.id}>
                <button
                  type="button"
                  onClick={() => loadConversation({ id: conv.id, messages: conv.messages })}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-muted/40 ${
                    conv.id === conversationId ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">{conv.title ?? "Conversation"}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {conv.message_count ?? conv.messages.length} msgs
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md py-6 text-center">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Bot className="h-6 w-6" />
            </span>
            <h3 className="font-display text-base font-semibold">{assistantName}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{systemContext}</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={`${m.timestamp}-${i}`}
            className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}
          >
            <div className="flex max-w-full items-end gap-2">
              {m.role === "assistant" && (
                <span className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </span>
              )}
              <div className={m.role === "user" ? "ai-bubble-user" : "ai-bubble-assistant"}>
                {m.role === "assistant" ? <Markdown content={m.content} /> : m.content}
              </div>
              {m.role === "user" && (
                <span className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/40">
                  <UserIcon className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <span className="mt-1 px-9 text-[10px] text-muted-foreground">
              {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="ai-bubble-assistant flex items-center gap-1.5 py-3">
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* Quick prompts */}
      {messages.length === 0 && quickPrompts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
          {quickPrompts.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setInput(p.prompt);
                textareaRef.current?.focus();
              }}
              className="min-h-[36px] rounded-full border border-border bg-muted/20 px-3 py-1.5 text-xs transition hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border px-4 py-3 sm:px-5">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Ask anything about your school..."
            className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/60"
          />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={disabled}
            className="h-11 shrink-0 rounded-xl px-4"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {input.length > 200 && (
          <div className="mt-1.5 text-right text-[10px] text-muted-foreground">
            {input.length} characters
          </div>
        )}
      </div>
    </div>
  );
}

export default AIAssistantShell;
