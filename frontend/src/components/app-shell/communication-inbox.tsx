import { useCallback, useEffect, useState } from "react";
import { Check, Inbox, RefreshCw, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import { useAppShell } from "./shell-context";
import { ShellGlassIcon } from "./glass-icon";
import "./communication-inbox.css";

type MessageRecord = {
  id: string;
  channel: string;
  body: string | null;
  status?: string;
  action?: string | null;
  template_code?: string | null;
  created_at?: string;
  received_at?: string;
};

type ProposalRecord = {
  id: string;
  channel: string;
  template_code: string;
  draft_body: string;
  status: string;
  created_at: string;
  recipient_user_ids: string[];
};

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

type Query = PromiseLike<QueryResult<Record<string, unknown>>> & {
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
};

type CommsClient = {
  from(table: string): { select(columns: string): Query };
  rpc(
    name: string,
    args: Record<string, string>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

type InboxItem = {
  id: string;
  direction: "Received" | "Sent";
  channel: string;
  content: string;
  status: string;
  at: string;
};

const client = supabase as unknown as CommsClient;

function messageItem(row: MessageRecord, direction: InboxItem["direction"]): InboxItem {
  return {
    id: `${direction}-${row.id}`,
    direction,
    channel: row.channel,
    content: row.body ?? "",
    status: row.status ?? row.action ?? "received",
    at: row.created_at ?? row.received_at ?? "",
  };
}

function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export function CommunicationInboxScreen() {
  const app = useApp();
  const shell = useAppShell();
  const userId = app.profile?.id ?? "";
  const orgId = app.profile?.school_id ?? "";
  const [tab, setTab] = useState<"inbox" | "organization">("inbox");
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [orgMessages, setOrgMessages] = useState<InboxItem[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const permission = await client.rpc("scholar_can", {
      p_org: orgId,
      p_perm: "comms.broadcast",
    });
    const orgAdmin = permission.data === true;
    setCanBroadcast(orgAdmin);
    const ownQueries = await Promise.all([
      client
        .from("outbound_messages")
        .select("id,channel,body,status,template_code,created_at")
        .eq("recipient_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
      client
        .from("inbound_messages")
        .select("id,channel,body,action,received_at")
        .eq("sender_user_id", userId)
        .order("received_at", { ascending: false })
        .limit(50),
    ]);
    if (ownQueries.some((result) => result.error)) {
      setError("Communication history is temporarily unavailable.");
      setInbox([]);
    } else {
      setInbox(
        [
          ...(ownQueries[0].data ?? []).map((row) =>
            messageItem(row as unknown as MessageRecord, "Sent"),
          ),
          ...(ownQueries[1].data ?? []).map((row) =>
            messageItem(row as unknown as MessageRecord, "Received"),
          ),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      );
    }

    if (orgAdmin) {
      const [sent, received, pending] = await Promise.all([
        client
          .from("outbound_messages")
          .select("id,channel,body,status,template_code,created_at")
          .order("created_at", { ascending: false })
          .limit(50),
        client
          .from("inbound_messages")
          .select("id,channel,body,action,received_at")
          .order("received_at", { ascending: false })
          .limit(50),
        client
          .from("comms_send_proposals")
          .select("id,channel,template_code,draft_body,status,created_at,recipient_user_ids")
          .eq("status", "pending_approval")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      if (sent.error || received.error || pending.error) {
        setError("Organization communications are temporarily unavailable.");
      } else {
        setOrgMessages(
          [
            ...(sent.data ?? []).map((row) => messageItem(row as unknown as MessageRecord, "Sent")),
            ...(received.data ?? []).map((row) =>
              messageItem(row as unknown as MessageRecord, "Received"),
            ),
          ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
        );
        setProposals((pending.data ?? []) as unknown as ProposalRecord[]);
      }
    }
    setLoading(false);
  }, [orgId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decideProposal(proposalId: string, decision: "approve" | "reject") {
    setBusyProposal(proposalId);
    setError(null);
    const { error: rpcError } = await client.rpc(
      decision === "approve" ? "comms_approve_send" : "comms_reject_send",
      { p_org: orgId, p_proposal: proposalId },
    );
    if (rpcError)
      setError("The proposal could not be updated. Check your organization permission.");
    setBusyProposal(null);
    await refresh();
  }

  const rows = tab === "organization" && canBroadcast ? orgMessages : inbox;

  return (
    <section className="app-shell-section comms-inbox" data-testid="communication-inbox">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <div className="comms-heading">
        <div>
          <p className="comms-eyebrow">COMMUNICATIONS · {shell.orgName}</p>
          <h1>Messages</h1>
          <p className="comms-subtitle">
            Your messages stay private to your account and active organization.
          </p>
        </div>
        <button
          type="button"
          className="comms-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="comms-summary">
        <ShellGlassIcon tone="accent">
          <Inbox />
        </ShellGlassIcon>
        <div>
          <strong>{inbox.length}</strong>
          <span>Messages for you</span>
        </div>
      </div>

      {canBroadcast ? (
        <div className="comms-tabs" role="tablist" aria-label="Communication views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "inbox"}
            onClick={() => setTab("inbox")}
          >
            My inbox
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "organization"}
            onClick={() => setTab("organization")}
          >
            Organization log
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="comms-error" role="alert">
          {error}
        </p>
      ) : null}

      {tab === "organization" && canBroadcast ? (
        <section className="comms-approval" aria-labelledby="comms-approval-title">
          <div className="comms-section-heading">
            <div>
              <p className="comms-eyebrow">GOVERNED SENDS</p>
              <h2 id="comms-approval-title">Awaiting approval</h2>
            </div>
            <span>{proposals.length} pending</span>
          </div>
          {proposals.length === 0 ? (
            <p className="comms-empty">No communication proposals need approval.</p>
          ) : (
            proposals.map((proposal) => (
              <article className="comms-proposal" key={proposal.id}>
                <div>
                  <strong>{proposal.template_code.replaceAll("_", " ")}</strong>
                  <span>
                    {proposal.channel} · {proposal.recipient_user_ids.length} recipient(s)
                  </span>
                  <p>{proposal.draft_body}</p>
                </div>
                <div className="comms-actions">
                  <button
                    type="button"
                    className="comms-approve"
                    onClick={() => void decideProposal(proposal.id, "approve")}
                    disabled={busyProposal !== null}
                    aria-label={`Approve ${proposal.template_code} proposal`}
                  >
                    <Check size={16} aria-hidden="true" />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="comms-reject"
                    onClick={() => void decideProposal(proposal.id, "reject")}
                    disabled={busyProposal !== null}
                    aria-label={`Reject ${proposal.template_code} proposal`}
                  >
                    <X size={16} aria-hidden="true" />
                    Reject
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      ) : null}

      <section
        className="comms-message-list"
        aria-label={tab === "organization" ? "Organization communications log" : "Your messages"}
      >
        {loading ? <p className="comms-empty">Loading messages…</p> : null}
        {!loading && rows.length === 0 ? (
          <p className="comms-empty">No messages to show yet.</p>
        ) : null}
        {rows.map((item) => (
          <article className="comms-message" key={item.id}>
            <div className="comms-message-topline">
              <span className={`comms-direction comms-direction-${item.direction.toLowerCase()}`}>
                {item.direction}
              </span>
              <span className="comms-channel">{item.channel.replaceAll("_", " ")}</span>
              <time dateTime={item.at}>{displayTime(item.at)}</time>
            </div>
            <p>{item.content || "No message content"}</p>
            <span className="comms-status">{item.status.replaceAll("_", " ")}</span>
          </article>
        ))}
      </section>
    </section>
  );
}
