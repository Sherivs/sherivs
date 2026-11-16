/**
 * Organization workforce screens (ENGINE-19, ADR-097): the agent roster, the role packet
 * selector and the workspace policy editor. Containers load through the existing Supabase
 * client; every change is a call to a server function that checks the caller and audits it.
 * When data cannot be read, the screen says so instead of showing an empty or invented state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  parseRoleContext,
  planCustomGrant,
  planOptionalChanges,
  planRemoveCustomGrant,
  type PacketPlan,
  type PacketView,
} from "@/lib/org-workforce/role-packet-view";
import {
  parsePolicyList,
  planPolicyChanges,
  type PolicyView,
} from "@/lib/org-workforce/policy-view";
import { planAgentAction, type AgentAction } from "@/lib/org-workforce/agent-actions";
import {
  EMPTY_SWITCHES,
  loadAgentState,
  rosterFromState,
  runAgentCall,
  type AgentScreenState,
} from "@/lib/org-workforce/agent-state-loader";
import { ORG_AGENTS } from "@/lib/org-workforce/org-agents";
import {
  AgentEventsPanel,
  OrgAgentRosterPanel,
  RolePacketPanel,
  WorkspacePolicyPanel,
} from "./org-workforce-panels";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  limit(count: number): Query;
};
type Client = {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): Promise<Result>;
};
const db = supabase as unknown as Client;

const rows = (data: unknown): Row[] =>
  Array.isArray(data) ? data.filter((r): r is Row => typeof r === "object" && r !== null) : [];
const text = (v: unknown): string => (typeof v === "string" ? v : "");

function Back() {
  return (
    <Link to={APP_SHELL_HOME as never} className="app-shell-back">
      ← Home
    </Link>
  );
}

const KNOWN_CODES = ORG_AGENTS.map((a) => a.pack.code);

export function OrgAgentsScreen() {
  const app = useApp();
  const school = app.school;
  const orgId = school?.id ?? "";
  const [state, setState] = useState<AgentScreenState>({
    canManage: false,
    applied: false,
    switches: EMPTY_SWITCHES,
    events: [],
    members: [],
    holdersKnown: false,
    error: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { canManage, applied, events } = state;

  const load = useCallback(async () => {
    if (!orgId) return;
    const next = await loadAgentState(db, orgId);
    setState(next);
    setError(next.error);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const view = useMemo(() => (school ? rosterFromState(school, state) : null), [school, state]);

  async function onAction(code: string, action: AgentAction, reason?: string) {
    const plan = planAgentAction({
      orgId,
      agentCode: code,
      action,
      ...(reason !== undefined ? { reason } : {}),
      knownCodes: KNOWN_CODES,
    });
    setError("");
    setNotice("");
    if (!plan.ok) {
      setError(plan.reason);
      return;
    }
    setBusy(true);
    const failure = await runAgentCall(db, plan.call.rpc, { ...plan.call.args });
    if (failure) setError(failure);
    else {
      setNotice("Change saved and audited.");
      await load();
    }
    setBusy(false);
  }

  async function onAcknowledge(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    const failure = await runAgentCall(db, "ack_org_agent_event", { p_event: id });
    if (failure) setError(failure);
    else {
      setNotice("Acknowledged.");
      await load();
    }
    setBusy(false);
  }

  return (
    <section className="app-shell-section" data-testid="org-agents-screen">
      <Back />
      <h1>Agents</h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {view ? (
        <OrgAgentRosterPanel
          view={view}
          {...(canManage && applied
            ? { actions: { busy, onAction: (c, a, r) => void onAction(c, a, r) } }
            : {})}
        />
      ) : (
        <p role="status">Your organization could not be loaded.</p>
      )}
      {canManage && applied ? (
        <AgentEventsPanel
          events={events}
          busy={busy}
          onAcknowledge={(id) => void onAcknowledge(id)}
        />
      ) : null}
      {!canManage && view ? (
        <p className="text-sm text-muted-foreground" data-testid="agents-manage-note">
          Switching agents on and off, and acknowledging what they raise, is for people who manage
          settings.
        </p>
      ) : null}
    </section>
  );
}

async function holdsRole(orgId: string, userId: string, roleCode: string): Promise<boolean> {
  const { data } = await db
    .from("user_role_assignments")
    .select("role_code,status")
    .eq("org_id", orgId)
    .eq("user_id", userId);
  return rows(data).some((r) => r.role_code === roleCode && r.status === "active");
}

export function RolePacketScreen() {
  const app = useApp();
  const orgId = app.school?.id ?? "";
  const userId = app.profile?.id ?? "";
  const [roles, setRoles] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [roleCode, setRoleCode] = useState("");
  const [view, setView] = useState<PacketView | null>(null);
  const [holds, setHolds] = useState(false);
  const [desired, setDesired] = useState<Record<string, boolean>>({});
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [grantCode, setGrantCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void (async () => {
      const [r, c] = await Promise.all([
        db.from("role_catalog").select("code,name,category,template_code,org_id").order("name"),
        db
          .from("permission_catalog")
          .select("code,module,label,sensitivity,protected")
          .order("code"),
      ]);
      if (r.error) setError(r.error.message);
      setRoles(rows(r.data));
      setCatalog(rows(c.data));
      setLoading(false);
    })();
  }, [orgId]);

  const load = useCallback(
    async (code: string) => {
      setView(null);
      setDesired({});
      setConfirmed([]);
      setError("");
      if (!code) return;
      const [ctx, held] = await Promise.all([
        db.rpc("role_context", { p_org: orgId, p_role: code }),
        holdsRole(orgId, userId, code),
      ]);
      if (ctx.error) {
        setError(ctx.error.message);
        return;
      }
      const parsed = parseRoleContext(ctx.data);
      if (!parsed) setError("This role's packet could not be read.");
      setView(parsed);
      setHolds(held);
    },
    [orgId, userId],
  );

  const plan: PacketPlan = useMemo(
    () =>
      view
        ? planOptionalChanges({ orgId, view, desired, confirmed, callerHoldsRole: holds })
        : { calls: [], blocked: [], awaitingConfirmation: [] },
    [orgId, view, desired, confirmed, holds],
  );

  async function run(calls: PacketPlan["calls"]) {
    setBusy(true);
    setError("");
    setNotice("");
    for (const call of calls) {
      const { error: e } = await db.rpc(call.rpc, { ...call.args });
      if (e) {
        setError(e.message);
        setBusy(false);
        return;
      }
    }
    setNotice("Change saved and audited.");
    await load(roleCode);
    setBusy(false);
  }

  const catalogRows = catalog.map((c) => ({
    code: text(c.code),
    protected: c.protected === true,
    sensitivity: text(c.sensitivity) || "internal",
  }));
  const grantPlan =
    view && grantCode
      ? planCustomGrant({
          orgId,
          view,
          permission: grantCode,
          catalog: catalogRows,
          confirmed,
          callerHoldsRole: holds,
        })
      : null;

  if (loading) return <p role="status">Loading roles…</p>;
  return (
    <section className="app-shell-section" data-testid="role-packet-screen">
      <Back />
      <h1>Role packets</h1>
      <p>Choose which permissions each role carries in your organization.</p>
      <label>
        Role{" "}
        <select
          value={roleCode}
          onChange={(e) => {
            setRoleCode(e.target.value);
            void load(e.target.value);
          }}
        >
          <option value="">Select a role</option>
          {roles.map((r) => (
            <option key={text(r.code)} value={text(r.code)}>
              {text(r.name)}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {view ? (
        <>
          <RolePacketPanel
            view={view}
            desired={desired}
            plan={plan}
            callerHoldsRole={holds}
            busy={busy}
            onToggle={(code, enabled) => setDesired((d) => ({ ...d, [code]: enabled }))}
            onConfirm={(code) => setConfirmed((c) => [...c, code])}
            onApply={() => void run(plan.calls)}
            onRemoveGrant={(id) => void run(planRemoveCustomGrant(view, id, holds).calls)}
          />
          <div className="grid gap-2">
            <label>
              Add a permission outside the packet{" "}
              <select value={grantCode} onChange={(e) => setGrantCode(e.target.value)}>
                <option value="">Select a permission</option>
                {catalogRows.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>
            {grantPlan?.blocked.length ? (
              <p role="alert">{grantPlan.blocked[0]!.code} cannot be added.</p>
            ) : null}
            {grantPlan?.awaitingConfirmation.length ? (
              <button type="button" onClick={() => setConfirmed((c) => [...c, grantCode])}>
                Confirm {grantCode} is sensitive
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || !grantPlan || grantPlan.calls.length === 0}
              onClick={() => grantPlan && void run(grantPlan.calls)}
            >
              Add permission
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function WorkspacePolicyScreen() {
  const app = useApp();
  const orgId = app.school?.id ?? "";
  const [view, setView] = useState<PolicyView | null>(null);
  const [policies, setPolicies] = useState<Record<string, boolean>>({});
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { data, error: e } = await db.rpc("workspace_policy_list", { p_org: orgId });
    if (e) setError(e.message);
    const parsed = parsePolicyList(data);
    if (!e && !parsed) setError("Workspace policies could not be read.");
    setView(parsed);
    setPolicies({});
    setModules({});
    setLoading(false);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const plan = useMemo(
    () =>
      view ? planPolicyChanges({ orgId, view, policies, modules }) : { calls: [], unknown: [] },
    [orgId, view, policies, modules],
  );

  async function apply() {
    setBusy(true);
    setError("");
    setNotice("");
    for (const call of plan.calls) {
      const { error: e } = await db.rpc(call.rpc, { ...call.args });
      if (e) {
        setError(e.message);
        setBusy(false);
        return;
      }
    }
    setNotice("Change saved and audited.");
    await load();
    setBusy(false);
  }

  if (loading) return <p role="status">Loading workspace policies…</p>;
  return (
    <section className="app-shell-section" data-testid="workspace-policy-screen">
      <Back />
      <h1>Workspace policies</h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {view ? (
        <WorkspacePolicyPanel
          view={view}
          desiredPolicies={policies}
          desiredModules={modules}
          pendingChanges={plan.calls.length}
          busy={busy}
          onPolicy={(k, v) => setPolicies((p) => ({ ...p, [k]: v }))}
          onModule={(k, v) => setModules((m) => ({ ...m, [k]: v }))}
          onApply={() => void apply()}
        />
      ) : null}
    </section>
  );
}
