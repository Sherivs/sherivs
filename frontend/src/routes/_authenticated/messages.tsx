import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Search, X, Reply, Download, Check, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/messages")({
  ssr: false,
  component: MessagesPage,
});

type MessageRow = {
  id: string;
  school_id: string;
  sender_id: string | null;
  recipient_id: string;
  subject: string | null;
  body: string;
  is_read: boolean | null;
  created_at: string;
  thread_id: string;
  parent_id: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
};

type UserLite = { id: string; full_name: string; role: string };

type ThreadSummary = {
  thread_id: string;
  last: MessageRow;
  count: number;
  unread: number;
  otherId: string | null;
};

const BUCKET = "message-attachments";

function MessagesPage() {
  const { school, authUser, profile } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id;
  const me = authUser?.id;
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const all = useQuery<MessageRow[]>({
    queryKey: ["messages-all", schoolId, me],
    enabled: !!schoolId && !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("school_id", schoolId!)
        .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as MessageRow[];
    },
  });

  // Realtime — refresh inbox on new messages addressed to me
  useEffect(() => {
    if (!schoolId || !me) return;
    const channel = supabase
      .channel("messages-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${me}` },
        () => void qc.invalidateQueries({ queryKey: ["messages-all"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schoolId, me, qc]);

  // Group into threads filtered by tab
  const threads: ThreadSummary[] = useMemo(() => {
    const rows = all.data ?? [];
    const map = new Map<string, MessageRow[]>();
    rows.forEach((m) => {
      const inTab = tab === "inbox" ? m.recipient_id === me : m.sender_id === me;
      if (!inTab) return;
      const arr = map.get(m.thread_id) ?? [];
      arr.push(m);
      map.set(m.thread_id, arr);
    });
    const list: ThreadSummary[] = [];
    map.forEach((msgs, thread_id) => {
      msgs.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      const last = msgs[0];
      const otherId = tab === "inbox" ? last.sender_id : last.recipient_id;
      const unread = msgs.filter((m) => m.recipient_id === me && !m.is_read).length;
      list.push({ thread_id, last, count: msgs.length, unread, otherId });
    });
    list.sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
    return list;
  }, [all.data, tab, me]);

  // Look up names
  const otherIds = useMemo(() => {
    const ids = new Set<string>();
    (all.data ?? []).forEach((m) => {
      if (m.sender_id) ids.add(m.sender_id);
      ids.add(m.recipient_id);
    });
    if (me) ids.delete(me);
    return Array.from(ids);
  }, [all.data, me]);

  const people = useQuery<Record<string, UserLite>>({
    queryKey: ["msg-people", schoolId, otherIds.join(",")],
    enabled: !!schoolId && otherIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, role")
        .in("id", otherIds);
      if (error) throw new Error(error.message);
      const map: Record<string, UserLite> = {};
      (data ?? []).forEach((u) => (map[u.id] = u as UserLite));
      return map;
    },
  });

  const filteredThreads = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if ((t.last.subject ?? "").toLowerCase().includes(q)) return true;
      if (t.last.body.toLowerCase().includes(q)) return true;
      const other = t.otherId ? people.data?.[t.otherId] : null;
      if (other?.full_name.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [threads, search, people.data]);

  const inboxUnread = useMemo(
    () => (all.data ?? []).filter((m) => m.recipient_id === me && !m.is_read).length,
    [all.data, me],
  );

  const sentCount = useMemo(
    () => new Set((all.data ?? []).filter((m) => m.sender_id === me).map((m) => m.thread_id)).size,
    [all.data, me],
  );

  const inboxCount = useMemo(
    () =>
      new Set((all.data ?? []).filter((m) => m.recipient_id === me).map((m) => m.thread_id)).size,
    [all.data, me],
  );

  return (
    <PortalPage title="Messages" subtitle={`Signed in as ${profile?.full_name ?? "—"}`}>
      <SectionGrid>
        <StatCard label="Inbox threads" value={inboxCount} />
        <StatCard label="Unread" value={inboxUnread} />
        <StatCard label="Sent threads" value={sentCount} />
        <StatCard label="School" value={school?.name ?? "—"} />
      </SectionGrid>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => {
              setTab("inbox");
              setSelectedThread(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === "inbox" ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            Inbox{" "}
            {inboxUnread > 0 && (
              <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] text-white">
                {inboxUnread}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setTab("sent");
              setSelectedThread(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === "sent" ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            Sent
          </button>
        </div>
        <div className="flex flex-1 items-center gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, body or sender…"
              className="pl-8"
            />
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            New
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="uos-card divide-y divide-border">
          {filteredThreads.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {search
                ? "No messages match your search."
                : tab === "inbox"
                  ? "No messages in your inbox."
                  : "You haven't sent any messages."}
            </p>
          ) : (
            filteredThreads.map((t) => {
              const other = t.otherId ? people.data?.[t.otherId] : null;
              const active = selectedThread === t.thread_id;
              return (
                <button
                  key={t.thread_id}
                  onClick={() => setSelectedThread(t.thread_id)}
                  className={`block w-full p-4 text-left hover:bg-muted/30 ${
                    active ? "bg-muted/40" : ""
                  } ${t.unread > 0 ? "border-l-2 border-primary" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">
                      {other?.full_name ?? "Unknown"}{" "}
                      <span className="text-xs uppercase text-muted-foreground">{other?.role}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(t.last.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm">{t.last.subject || "(no subject)"}</div>
                    {t.count > 1 && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px]">
                        {t.count}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t.last.attachment_name && <Paperclip className="mr-1 inline size-3" />}
                    {t.last.body}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <ThreadView
          threadId={selectedThread}
          allMessages={all.data ?? []}
          people={people.data ?? {}}
          me={me!}
          schoolId={schoolId!}
          onChanged={() => void qc.invalidateQueries({ queryKey: ["messages-all"] })}
        />
      </div>

      {composeOpen && (
        <ComposeModal
          schoolId={schoolId!}
          senderId={me!}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            void qc.invalidateQueries({ queryKey: ["messages-all"] });
          }}
        />
      )}
    </PortalPage>
  );
}

function ThreadView({
  threadId,
  allMessages,
  people,
  me,
  schoolId,
  onChanged,
}: {
  threadId: string | null;
  allMessages: MessageRow[];
  people: Record<string, UserLite>;
  me: string;
  schoolId: string;
  onChanged: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const messages = useMemo(
    () =>
      allMessages
        .filter((m) => m.thread_id === threadId)
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [allMessages, threadId],
  );

  useEffect(() => {
    setReplying(false);
    setBody("");
    setFile(null);
    setErr(null);
  }, [threadId]);

  // Mark unread messages in this thread as read
  useEffect(() => {
    if (!threadId) return;
    const unread = messages.filter((m) => m.recipient_id === me && !m.is_read);
    if (unread.length === 0) return;
    void (async () => {
      await supabase
        .from("messages")
        .update({ is_read: true })
        .in(
          "id",
          unread.map((m) => m.id),
        );
      onChanged();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, messages.length]);

  if (!threadId) {
    return (
      <div className="uos-card p-6">
        <p className="text-sm text-muted-foreground">Select a thread to read.</p>
      </div>
    );
  }

  const first = messages[0];
  const last = messages[messages.length - 1];
  const recipientId = last && last.sender_id === me ? last.recipient_id : (last?.sender_id ?? null);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !recipientId) return;
    setSending(true);
    setErr(null);
    try {
      let attachment_url: string | null = null;
      let attachment_name: string | null = null;
      let attachment_size: number | null = null;
      if (file) {
        const path = `${me}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type,
        });
        if (up.error) throw new Error(up.error.message);
        attachment_url = up.data.path;
        attachment_name = file.name;
        attachment_size = file.size;
      }
      const { error } = await supabase.from("messages").insert({
        school_id: schoolId,
        sender_id: me,
        recipient_id: recipientId,
        subject: first?.subject ? `Re: ${first.subject.replace(/^Re:\s*/i, "")}` : null,
        body: body.trim(),
        thread_id: threadId!,
        parent_id: last?.id ?? null,
        attachment_url,
        attachment_name,
        attachment_size,
      });
      if (error) throw new Error(error.message);
      setBody("");
      setFile(null);
      setReplying(false);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function downloadAttachment(m: MessageRow) {
    if (!m.attachment_url) return;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(m.attachment_url, 60);
    if (error || !data) return;
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="uos-card flex flex-col">
      <header className="border-b border-border p-6">
        <h2 className="font-display text-xl font-bold">{first?.subject || "(no subject)"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {messages.length} message{messages.length === 1 ? "" : "s"} in thread
        </p>
      </header>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
        {messages.map((m) => {
          const mine = m.sender_id === me;
          const who = mine ? "You" : (people[m.sender_id ?? ""]?.full_name ?? "Unknown");
          return (
            <article
              key={m.id}
              className={`rounded-lg border border-border p-4 ${
                mine ? "ml-8 bg-muted/20" : "mr-8"
              }`}
            >
              <header className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{who}</span>
                <span className="flex items-center gap-1.5">
                  {mine &&
                    (m.is_read ? (
                      <span className="flex items-center gap-0.5 text-emerald-400" title="Read">
                        <CheckCheck className="size-3" /> Read
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5" title="Delivered">
                        <Check className="size-3" /> Sent
                      </span>
                    ))}
                  {new Date(m.created_at).toLocaleString()}
                </span>
              </header>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
              {m.attachment_url && (
                <button
                  type="button"
                  onClick={() => downloadAttachment(m)}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
                >
                  <Download className="size-3" />
                  {m.attachment_name ?? "Attachment"}
                  {m.attachment_size && (
                    <span className="text-muted-foreground">
                      ({Math.ceil(m.attachment_size / 1024)} KB)
                    </span>
                  )}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <footer className="border-t border-border p-4">
        {!replying ? (
          <button
            onClick={() => setReplying(true)}
            disabled={!recipientId}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Reply className="size-4" /> Reply
          </button>
        ) : (
          <form onSubmit={sendReply} className="space-y-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Write a reply…"
              required
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Paperclip className="size-4" />
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? file.name : "Attach file"}
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFile(null);
                    }}
                    className="ml-1 text-rose-400"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplying(false);
                    setBody("");
                    setFile(null);
                  }}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending || !body.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            </div>
            {err && <p className="text-xs text-rose-400">{err}</p>}
          </form>
        )}
      </footer>
    </div>
  );
}

function ComposeModal({
  schoolId,
  senderId,
  onClose,
  onSent,
}: {
  schoolId: string;
  senderId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [q, setQ] = useState("");
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const users = useQuery<UserLite[]>({
    queryKey: ["msg-recipients", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, role")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .neq("id", senderId)
        .order("full_name")
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as UserLite[];
    },
  });

  const filtered = (users.data ?? []).filter((u) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return u.full_name.toLowerCase().includes(n) || u.role.toLowerCase().includes(n);
  });

  const recipient = users.data?.find((u) => u.id === recipientId);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientId || !body.trim()) return;
    setSending(true);
    setErr(null);
    try {
      let attachment_url: string | null = null;
      let attachment_name: string | null = null;
      let attachment_size: number | null = null;
      if (file) {
        const path = `${senderId}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type,
        });
        if (up.error) throw new Error(up.error.message);
        attachment_url = up.data.path;
        attachment_name = file.name;
        attachment_size = file.size;
      }
      const { error } = await supabase.from("messages").insert({
        school_id: schoolId,
        sender_id: senderId,
        recipient_id: recipientId,
        subject: subject.trim() || null,
        body: body.trim(),
        thread_id: crypto.randomUUID(),
        attachment_url,
        attachment_name,
        attachment_size,
      });
      if (error) throw new Error(error.message);
      onSent();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={send}
        className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-background p-6"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">New message</h3>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground">
            ✕
          </button>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">To</label>
          {recipient ? (
            <div className="mt-1 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>
                {recipient.full_name}{" "}
                <span className="text-xs uppercase text-muted-foreground">{recipient.role}</span>
              </span>
              <button
                type="button"
                onClick={() => setRecipientId(null)}
                className="text-xs text-muted-foreground"
              >
                change
              </button>
            </div>
          ) : (
            <>
              <Input
                placeholder="Search by name or role…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="mt-1"
              />
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border">
                {filtered.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No users found.</p>
                ) : (
                  filtered.slice(0, 20).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setRecipientId(u.id)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      {u.full_name}{" "}
                      <span className="text-xs uppercase text-muted-foreground">{u.role}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Optional"
            className="mt-1"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Message</label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={6}
            className="mt-1"
          />
        </div>

        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Paperclip className="size-4" />
            <input
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? file.name : "Attach file (optional)"}
            {file && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setFile(null);
                }}
                className="ml-1 text-rose-400"
              >
                <X className="size-3" />
              </button>
            )}
          </label>
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending || !recipientId || !body.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
