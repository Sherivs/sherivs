/**
 * Playbook runner orchestration (ENGINE-05, ADR-083). Ports only: no database,
 * vendor or clock import, so it is driven in memory in tests and by adapters in
 * production.
 *
 * Order per step is fixed: kill switch, budget, authorise (broker for a tool,
 * ladder for an internal step), then act. The run stops at the first step that
 * needs a human, is denied, or fails; a stopped run never executes a later step.
 */
import {
  brokerToolCall,
  type AuthorityPort,
  type LedgerPort,
} from "../tool-broker/broker-service.server";
import type { ToolDefinition } from "../tool-broker/tool-contract";
import { toolById } from "../tool-broker/platform-tools";
import type { EffectiveAutonomy } from "../twin-engine/autonomy-ladder";
import type { RolePack } from "../twin-engine/role-pack";
import type { BindingTable } from "./capability-bindings";
import {
  abortRun,
  awaitApproval,
  completeRun,
  recordStep,
  resolveStep,
  type PlaybookRun,
  type StepResult,
} from "./run-state";

export interface ApprovalEvidence {
  readonly approvalRef: string;
  readonly approverKind: "role_owner" | "platform_staff" | "sheriff";
}

export interface RunnerPorts {
  readonly broker: { readonly authority: AuthorityPort; readonly ledger: LedgerPort };
  readonly killSwitch: () => Promise<boolean>;
  /** Ladder result for a capability of this context. */
  readonly effective: (capabilityId: string) => Promise<EffectiveAutonomy>;
  readonly handlers: Readonly<Record<string, (run: PlaybookRun) => Promise<"ok" | "failed">>>;
  /** Performs a cleared tool call and records its outcome. Never decides. */
  readonly execute: (input: {
    readonly tool: ToolDefinition;
    readonly args: Readonly<Record<string, unknown>>;
    readonly decisionId: string;
    readonly idempotencyKey: string;
    readonly approval: ApprovalEvidence | null;
  }) => Promise<"succeeded" | "failed">;
}

export interface Budgeted {
  /** Brokered or T1 internal calls already made today; updated as the run proceeds. */
  readonly actionsToday: number;
}

export interface DriveResult {
  readonly run: PlaybookRun;
  readonly actionsToday: number;
}

export const stepArgs = (run: PlaybookRun) => ({
  subjectRef: run.subjectRef,
  correlationId: run.correlationId,
});

export async function driveRun(
  ports: RunnerPorts,
  pack: RolePack,
  bindings: BindingTable,
  start: PlaybookRun,
  budget: Budgeted,
): Promise<DriveResult> {
  let run = start;
  let actions = budget.actionsToday;
  const playbook = pack.playbooks.find((p) => p.id === run.playbookId);
  if (!playbook) return { run: abortRun(run, "unknown_playbook"), actionsToday: actions };

  while (run.status === "running") {
    if (run.nextStep >= playbook.steps.length) {
      run = completeRun(run);
      break;
    }
    if (await ports.killSwitch())
      return { run: abortRun(run, "kill_switch"), actionsToday: actions };
    if (actions >= pack.budget.dailyActions)
      return { run: abortRun(run, "action_budget"), actionsToday: actions };

    const index = run.nextStep;
    const capId = playbook.steps[index] as string;
    const cap = pack.capabilities.find((c) => c.id === capId);
    const binding = bindings[capId];
    if (!cap || !binding)
      return { run: abortRun(run, "unbound_capability"), actionsToday: actions };

    if (binding.kind === "tool") {
      const tool = toolById(binding.toolId);
      if (!tool) return { run: abortRun(run, "unknown_tool"), actionsToday: actions };
      const idempotencyKey = `${run.runId}:${index}`;
      const args = stepArgs(run);
      actions += 1;
      const r = await brokerToolCall(ports.broker, {
        twinContextId: run.contextId,
        tool,
        args,
        idempotencyKey,
      });
      if (!r.ok) return { run: abortRun(run, `broker_${r.error}`), actionsToday: actions };
      const d = r.decision;
      if (d.verdict === "deny") {
        run = recordStep(run, capId, {
          kind: "denied",
          code: d.denyCode ?? "unspecified",
          decisionId: r.id,
        });
        return {
          run: abortRun(run, `denied:${d.denyCode ?? "unspecified"}`),
          actionsToday: actions,
        };
      }
      if (d.verdict === "shadow" || d.verdict === "propose") {
        run = recordStep(run, capId, { kind: "not_executed", why: d.verdict, decisionId: r.id });
        continue;
      }
      if (d.verdict === "queue_approval" || d.verdict === "sheriff_passkey") {
        run = recordStep(run, capId, {
          kind: "awaiting",
          approver: d.approver ?? "role_owner",
          decisionId: r.id,
        });
        run = awaitApproval(run, {
          stepIndex: index,
          decisionId: r.id,
          approver: d.approver ?? "role_owner",
        });
        return { run, actionsToday: actions };
      }
      // verdict === "execute"
      if (r.replayed) {
        // An earlier attempt already decided this step; whether it acted is unknown, so do not act twice.
        run = recordStep(run, capId, { kind: "not_executed", why: "replayed", decisionId: r.id });
        continue;
      }
      const outcome = await ports.execute({
        tool,
        args,
        decisionId: r.id,
        idempotencyKey,
        approval: null,
      });
      run = recordStep(run, capId, { kind: "executed", outcome, decisionId: r.id });
      if (outcome === "failed") return { run: abortRun(run, "step_failed"), actionsToday: actions };
      continue;
    }

    // internal step
    const effective = await ports.effective(capId);
    const handler = ports.handlers[binding.handlerId];
    if (cap.tier === "T0" || effective === "act_autonomously") {
      if (!handler) return { run: abortRun(run, "no_handler"), actionsToday: actions };
      if (cap.tier !== "T0") actions += 1;
      const outcome = (await handler(run)) === "ok" ? "succeeded" : "failed";
      run = recordStep(run, capId, { kind: "executed", outcome, decisionId: null });
      if (outcome === "failed") return { run: abortRun(run, "step_failed"), actionsToday: actions };
      continue;
    }
    if (effective === "act_with_approval") {
      const approver = cap.approver ?? "role_owner";
      run = recordStep(run, capId, { kind: "awaiting", approver, decisionId: null });
      run = awaitApproval(run, { stepIndex: index, decisionId: null, approver });
      return { run, actionsToday: actions };
    }
    run = recordStep(run, capId, {
      kind: "not_executed",
      why: effective === "propose_only" ? "propose" : "shadow",
      decisionId: null,
    });
  }
  return { run, actionsToday: actions };
}

export type ResumeResult =
  | { readonly resumed: true; readonly run: PlaybookRun; readonly actionsToday: number }
  | {
      readonly resumed: false;
      readonly run: PlaybookRun;
      readonly reason: "not_waiting" | "wrong_approver" | "kill_switch";
    };

export async function resumeRun(
  ports: RunnerPorts,
  pack: RolePack,
  bindings: BindingTable,
  waiting: PlaybookRun,
  decision: { readonly approved: boolean; readonly evidence: ApprovalEvidence },
  budget: Budgeted,
): Promise<ResumeResult> {
  const pending = waiting.pending;
  if (waiting.status !== "awaiting_approval" || !pending) {
    return { resumed: false, run: waiting, reason: "not_waiting" };
  }
  if (await ports.killSwitch())
    return { resumed: false, run: abortRun(waiting, "kill_switch"), reason: "kill_switch" };
  if (decision.evidence.approverKind !== pending.approver) {
    return { resumed: false, run: waiting, reason: "wrong_approver" };
  }
  if (!decision.approved) {
    return {
      resumed: true,
      run: abortRun(waiting, "approval_denied"),
      actionsToday: budget.actionsToday,
    };
  }

  const record = waiting.steps.find((s) => s.index === pending.stepIndex);
  const binding = record ? bindings[record.capabilityId] : undefined;
  if (!record || !binding)
    return {
      resumed: true,
      run: abortRun(waiting, "unbound_capability"),
      actionsToday: budget.actionsToday,
    };

  let result: StepResult;
  if (binding.kind === "tool") {
    const tool = toolById(binding.toolId);
    if (!tool || pending.decisionId === null) {
      return {
        resumed: true,
        run: abortRun(waiting, "unknown_tool"),
        actionsToday: budget.actionsToday,
      };
    }
    const outcome = await ports.execute({
      tool,
      args: stepArgs(waiting),
      decisionId: pending.decisionId,
      idempotencyKey: `${waiting.runId}:${pending.stepIndex}`,
      approval: decision.evidence,
    });
    result = { kind: "executed", outcome, decisionId: pending.decisionId };
  } else {
    const handler = ports.handlers[binding.handlerId];
    if (!handler)
      return {
        resumed: true,
        run: abortRun(waiting, "no_handler"),
        actionsToday: budget.actionsToday,
      };
    result = {
      kind: "executed",
      outcome: (await handler(waiting)) === "ok" ? "succeeded" : "failed",
      decisionId: null,
    };
  }
  let run: PlaybookRun = resolveStep(waiting, pending.stepIndex, result);
  run = { ...run, status: "running", pending: null };
  if (result.kind === "executed" && result.outcome === "failed") {
    return { resumed: true, run: abortRun(run, "step_failed"), actionsToday: budget.actionsToday };
  }
  const driven = await driveRun(ports, pack, bindings, run, budget);
  return { resumed: true, run: driven.run, actionsToday: driven.actionsToday };
}
