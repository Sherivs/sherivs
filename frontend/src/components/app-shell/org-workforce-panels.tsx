/**
 * Presentational panels for the organization workforce (ENGINE-19, ADR-097).
 * They render a view model and call back; they hold no data access, so they can be
 * rendered and tested without a database.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BLOCK_TEXT,
  needsConfirmation,
  type PacketPlan,
  type PacketPermission,
  type PacketView,
} from "@/lib/org-workforce/role-packet-view";
import type { PolicyView } from "@/lib/org-workforce/policy-view";
import type { RosterCard, RosterView } from "@/lib/org-workforce/roster-view";

function AgentCard({ card }: { card: RosterCard }) {
  return (
    <li data-testid={`agent-${card.code}`} className="rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <strong>{card.codename}</strong>
        <span data-testid={`agent-status-${card.code}`} className="text-sm text-muted-foreground">
          {card.statusLabel}
        </span>
      </div>
      <p className="text-sm">{card.title}</p>
      <p className="text-sm text-muted-foreground">
        Approved by the {card.accountable}. Starts by proposing; a person decides.
      </p>
      <p className="text-sm text-muted-foreground">
        {card.capabilities.reads} reads · {card.capabilities.needsApproval} need approval ·{" "}
        {card.capabilities.proposesOnly} propose only
      </p>
      {card.minTierLabel && card.status === "locked" ? (
        <p className="text-sm">Included from the {card.minTierLabel} plan.</p>
      ) : null}
      <Button type="button" disabled={!card.switchOn.enabled} className="mt-2">
        Switch on
      </Button>
      {card.switchOn.disabledReason ? (
        <p className="text-xs text-muted-foreground" data-testid={`agent-why-${card.code}`}>
          {card.switchOn.disabledReason}
        </p>
      ) : null}
    </li>
  );
}

export function OrgAgentRosterPanel({ view }: { view: RosterView }) {
  return (
    <div data-testid="org-agent-roster" className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your agents · {view.planLabel} plan</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {view.summary.included} of {view.summary.total} agents are included in your plan.
            {view.summary.next
              ? ` ${view.summary.next.label} adds ${view.summary.next.adds} more.`
              : ""}
          </p>
          {!view.organizationActive ? (
            <p role="alert">Your organization is not active, so no agent can run.</p>
          ) : null}
        </CardContent>
      </Card>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="roster-included">
        {view.included.map((c) => (
          <AgentCard key={c.code} card={c} />
        ))}
      </ul>
      {view.upgrade.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Available on a higher plan</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="roster-upgrade">
              {view.upgrade.map((c) => (
                <AgentCard key={c.code} card={c} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function RolePacketPanel(props: {
  view: PacketView;
  /** The wanted state for each optional permission, as the person has set it. */
  desired: Readonly<Record<string, boolean>>;
  plan: PacketPlan;
  callerHoldsRole: boolean;
  busy: boolean;
  onToggle: (code: string, enabled: boolean) => void;
  onConfirm: (code: string) => void;
  onApply: () => void;
  onRemoveGrant: (id: string) => void;
}) {
  const { view } = props;
  const row = (p: PacketPermission, optional: boolean) => {
    const wanted = props.desired[p.code] ?? p.enabled;
    const awaiting = props.plan.awaitingConfirmation.includes(p.code);
    return (
      <li key={p.code} className="flex items-start gap-2 py-1" data-testid={`perm-${p.code}`}>
        <input
          type="checkbox"
          aria-label={p.label}
          checked={optional ? wanted : true}
          disabled={!optional || props.callerHoldsRole}
          onChange={(e) => props.onToggle(p.code, e.target.checked)}
        />
        <span>
          {p.label} <code className="text-xs">{p.code}</code>
          {needsConfirmation(p) ? (
            <span className="ml-1 text-xs" data-testid={`sensitive-${p.code}`}>
              sensitive
            </span>
          ) : null}
          {awaiting ? (
            <Button type="button" onClick={() => props.onConfirm(p.code)} className="ml-2">
              Confirm {p.code}
            </Button>
          ) : null}
        </span>
      </li>
    );
  };
  return (
    <div data-testid="role-packet" className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {view.role.name}
            {view.role.custom ? " (custom role)" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Template {view.role.template}
            {view.scope ? ` · scope ${view.scope}` : ""}
            {view.dataSensitivity ? ` · data ${view.dataSensitivity}` : ""}
            {view.approvalLimitNgn !== null
              ? ` · approves up to ₦${view.approvalLimitNgn.toLocaleString("en-NG")}`
              : ""}
          </p>
          {props.callerHoldsRole ? (
            <p role="alert" data-testid="self-hold">
              {BLOCK_TEXT.you_hold_this_role}
            </p>
          ) : null}
          {view.conflictingTemplates.length > 0 ? (
            <p className="text-sm" data-testid="sod">
              Never combine with: {view.conflictingTemplates.join(", ")}.
            </p>
          ) : null}
          {view.guardrails.length > 0 ? (
            <ul className="text-sm" data-testid="guardrails">
              {view.guardrails.map((g) => (
                <li key={g.code}>{g.description || g.code}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Always included</CardTitle>
        </CardHeader>
        <CardContent>
          <ul data-testid="packet-mandatory">{view.mandatory.map((p) => row(p, false))}</ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Choose for your organization</CardTitle>
        </CardHeader>
        <CardContent>
          <ul data-testid="packet-optional">{view.optional.map((p) => row(p, true))}</ul>
          {props.plan.blocked.length > 0 ? (
            <ul role="alert" data-testid="packet-blocked">
              {props.plan.blocked.map((b) => (
                <li key={b.code}>
                  {b.code}: {BLOCK_TEXT[b.reason]}
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            disabled={props.busy || props.plan.calls.length === 0}
            onClick={props.onApply}
          >
            Save {props.plan.calls.length} change{props.plan.calls.length === 1 ? "" : "s"}
          </Button>
        </CardContent>
      </Card>
      {view.customGrants.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Extra permissions added by your organization</CardTitle>
          </CardHeader>
          <CardContent>
            <ul data-testid="packet-custom">
              {view.customGrants.map((g) => (
                <li key={g.id}>
                  <code>{g.permission}</code>
                  <Button
                    type="button"
                    disabled={props.busy || props.callerHoldsRole}
                    onClick={() => props.onRemoveGrant(g.id)}
                    className="ml-2"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function WorkspacePolicyPanel(props: {
  view: PolicyView;
  desiredPolicies: Readonly<Record<string, boolean>>;
  desiredModules: Readonly<Record<string, boolean>>;
  pendingChanges: number;
  busy: boolean;
  onPolicy: (key: string, enabled: boolean) => void;
  onModule: (key: string, enabled: boolean) => void;
  onApply: () => void;
}) {
  return (
    <div data-testid="workspace-policies" className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Workspace policies</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {props.view.policies.map((p) => (
              <li key={p.key} data-testid={`policy-${p.key}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={props.desiredPolicies[p.key] ?? p.enabled}
                    onChange={(e) => props.onPolicy(p.key, e.target.checked)}
                  />{" "}
                  {p.label}
                  {p.defaultOn ? "" : " (off by default)"}
                </label>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {props.view.modules.map((m) => (
              <li key={m.key} data-testid={`module-${m.key}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={props.desiredModules[m.key] ?? m.enabled}
                    onChange={(e) => props.onModule(m.key, e.target.checked)}
                  />{" "}
                  {m.key}
                </label>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={props.busy || props.pendingChanges === 0}
            onClick={props.onApply}
          >
            Save {props.pendingChanges} change{props.pendingChanges === 1 ? "" : "s"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
