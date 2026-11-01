import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  AudioLines,
  Check,
  History,
  Paperclip,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import {
  assistantProposalRequiresPasskey,
  createAssistantClient,
  type AssistantAttachment,
  type AssistantProposal,
} from "@/lib/assistant/assistant-client";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import { useAppShell } from "./shell-context";
import { ShellGlassIcon } from "./glass-icon";

const assistantClient = createAssistantClient();
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const QUICK_REPLIES = ["Help me plan my day", "What needs my attention?", "Show my assigned work"];

const PERSONA_BY_ROLE: Readonly<Record<string, string>> = {
  admin: "My School Assistant",
  admin_officer: "My School Assistant",
  bursar: "My Bursary Assistant",
  driver: "My Route Assistant",
  form_teacher: "My Teaching Assistant",
  head_of_institution: "My Leadership Assistant",
  hod: "My Department Assistant",
  hq: "My Platform Assistant",
  librarian: "My Library Assistant",
  nurse: "My Health Assistant",
  parent: "My Family Assistant",
  principal: "My Leadership Assistant",
  proprietor: "My Organization Assistant",
  student: "My Learning Companion",
  super_admin: "My Platform Assistant",
  support_staff: "My Work Assistant",
  teacher: "My Teaching Assistant",
};

interface ChatMessage {
  id: number;
  kind: "user" | "assistant" | "system";
  text: string;
  proposals?: readonly AssistantProposal[];
}

interface Conversation {
  id: number;
  title: string;
  messages: ChatMessage[];
}

export function assistantPersonaForRole(role: string | null | undefined): string {
  return (role && PERSONA_BY_ROLE[role]) || "My Assistant";
}

export function AssistantScreen() {
  const app = useApp();
  const shell = useAppShell();
  const persona = assistantPersonaForRole(app.role);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [recording, setRecording] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [conversationSequence, setConversationSequence] = useState(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextMessageId = useRef(1);
  const contextReady = Boolean(app.profile?.id && app.school?.id && app.role);
  const queuedCount = messages.filter((message) => message.kind === "user").length;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function addMessage(message: Omit<ChatMessage, "id">) {
    const id = nextMessageId.current++;
    setMessages((current) => [...current, { ...message, id }]);
  }

  async function sendMessage(text = draft) {
    const message = text.trim();
    if (!message || sending || !contextReady) return;
    setDraft("");
    setSending(true);
    addMessage({ kind: "user", text: message });
    if (!online) {
      addMessage({
        kind: "system",
        text: "Queued in this tab for this session. Nothing has been sent to a server.",
      });
      setSending(false);
      return;
    }

    try {
      const result = await assistantClient.send({
        context: {
          userId: app.profile!.id,
          organizationId: app.school!.id,
          role: app.role!,
        },
        message,
        attachments,
      });
      if (result.status === "unavailable") {
        addMessage({
          kind: "system",
          text: "Assistant service is not available yet. Your message was not sent.",
        });
      } else {
        addMessage({
          kind: "assistant",
          text: result.reply,
          proposals: result.proposals,
        });
      }
    } catch {
      addMessage({
        kind: "system",
        text: "Assistant service could not be reached. Your message was not sent.",
      });
    } finally {
      setAttachments([]);
      setSending(false);
    }
  }

  function startNewConversation() {
    if (messages.length) {
      const firstMessage = messages.find((message) => message.kind === "user")?.text;
      setConversations((current) => [
        {
          id: conversationSequence,
          title: firstMessage?.slice(0, 52) || `Conversation ${conversationSequence}`,
          messages,
        },
        ...current,
      ]);
      setConversationSequence((current) => current + 1);
    }
    setMessages([]);
    setAttachments([]);
    setHistoryOpen(false);
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    setAttachmentMessage(null);
    const accepted: AssistantAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentMessage(`${file.name} exceeds the 5 MB attachment limit.`);
        continue;
      }
      accepted.push({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        file,
      });
    }
    setAttachments((current) => [...current, ...accepted].slice(0, 5));
  }

  async function toggleRecording() {
    setAttachmentMessage(null);
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAttachmentMessage("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, {
          type: blob.type,
        });
        if (file.size <= MAX_ATTACHMENT_BYTES) {
          setAttachments((current) =>
            [...current, { name: file.name, contentType: file.type, size: file.size, file }].slice(
              0,
              5,
            ),
          );
          setAttachmentMessage(
            "Voice note captured in this tab only; it will not be uploaded until an approved assistant service is connected.",
          );
        } else {
          setAttachmentMessage("Voice note exceeds the 5 MB attachment limit.");
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
      });
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setAttachmentMessage("Microphone access was not granted.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  return (
    <section className="app-shell-assistant" data-testid="assistant-screen">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <header className="app-shell-assistant-header">
        <ShellGlassIcon size={48} tone="accent">
          <Sparkles />
        </ShellGlassIcon>
        <div>
          <h1>{persona}</h1>
          <p>
            <span className="app-shell-assistant-role">{shell.roleTitle}</span>
            <span className={`app-shell-assistant-status${online ? "" : " is-offline"}`}>
              {online ? "Service unavailable" : "Offline"}
            </span>
          </p>
        </div>
        <div className="app-shell-assistant-tools">
          <button
            type="button"
            className="app-shell-assistant-tool"
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History size={17} />
          </button>
          <button
            type="button"
            className="app-shell-assistant-tool"
            aria-label="New conversation"
            onClick={startNewConversation}
          >
            <Plus size={17} />
          </button>
        </div>
      </header>

      {historyOpen ? (
        <aside className="app-shell-assistant-history" aria-label="Conversation history">
          <strong>Recent conversations</strong>
          {conversations.length ? (
            conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => {
                  setMessages(conversation.messages);
                  setHistoryOpen(false);
                }}
              >
                {conversation.title}
              </button>
            ))
          ) : (
            <p className="app-shell-empty">No saved conversations in this session.</p>
          )}
        </aside>
      ) : null}

      {!contextReady ? (
        <p className="app-shell-assistant-notice" role="status">
          Assistant context is unavailable until your authorized role and organization load.
        </p>
      ) : null}

      <div className="app-shell-assistant-transcript" aria-live="polite" aria-label="Conversation">
        {!messages.length ? (
          <div className="app-shell-assistant-welcome">
            <h2>How can I help with your work?</h2>
            <p>
              I only use information authorized for your active workspace. No assistant service is
              connected yet, so I will not invent answers.
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`app-shell-chat-message is-${message.kind}`}
            data-testid={`assistant-message-${message.kind}`}
          >
            {message.kind === "assistant" ? (
              <ShellGlassIcon size={30} tone="accent">
                <Sparkles />
              </ShellGlassIcon>
            ) : null}
            <div className="app-shell-chat-bubble">
              <p>{message.text}</p>
              {message.proposals?.map((proposal) => (
                <article className="app-shell-assistant-proposal" key={proposal.id}>
                  <ShieldCheck size={17} aria-hidden="true" />
                  <div>
                    <strong>{proposal.riskTier} proposal</strong>
                    <p>{proposal.summary}</p>
                    {assistantProposalRequiresPasskey(proposal) ? (
                      <small>
                        Human approval and passkey step-up are required in the authorized console.
                        This chat cannot approve or execute this action.
                      </small>
                    ) : (
                      <small>Proposal only. Execution is not available in this chat.</small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </article>
        ))}
        {sending ? (
          <p className="app-shell-assistant-typing" role="status">
            Checking assistant availability…
          </p>
        ) : null}
        {queuedCount ? (
          <p className="app-shell-assistant-queue" role="status">
            <Check size={14} aria-hidden="true" />
            {queuedCount} message{queuedCount === 1 ? "" : "s"} kept in this tab only
          </p>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <div className="app-shell-assistant-quick-replies" aria-label="Suggested prompts">
          {QUICK_REPLIES.map((reply) => (
            <button type="button" key={reply} onClick={() => setDraft(reply)}>
              {reply}
            </button>
          ))}
        </div>
      ) : null}

      <form className="app-shell-assistant-composer" onSubmit={submit}>
        {attachments.length ? (
          <div className="app-shell-assistant-attachments" aria-label="Attachments">
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}:${index}`}>
                {attachment.name}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label className="app-shell-assistant-input-label">
          <span className="sr-only">Message {persona}</span>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
            placeholder="Message your assistant…"
            rows={2}
            maxLength={4000}
            disabled={!contextReady || sending}
            data-testid="assistant-composer"
          />
        </label>
        <div className="app-shell-assistant-composer-tools">
          <label className="app-shell-assistant-tool" aria-label="Attach a file">
            <Paperclip size={17} />
            <input
              type="file"
              accept="image/*,application/pdf,text/plain"
              multiple
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
          <button
            type="button"
            className={`app-shell-assistant-tool${recording ? " is-recording" : ""}`}
            aria-label={recording ? "Stop voice note" : "Record voice note"}
            onClick={() => void toggleRecording()}
          >
            <AudioLines size={17} />
          </button>
          <button
            type="submit"
            className="app-shell-assistant-send"
            aria-label="Send message"
            disabled={!draft.trim() || !contextReady || sending}
          >
            <ArrowUp size={18} />
          </button>
        </div>
        {attachmentMessage ? (
          <p className="app-shell-assistant-notice" role="status">
            {attachmentMessage}
          </p>
        ) : null}
        {!online ? (
          <p className="app-shell-assistant-offline">
            Offline queue is temporary and limited to this open tab. Reconnect before expecting a
            response.
          </p>
        ) : null}
      </form>
    </section>
  );
}
