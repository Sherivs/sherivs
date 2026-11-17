/**
 * Agent workbench view model (ENGINE-16, ADR-094).
 *
 * The workbench is the working surface for one agent: its queues, its quick actions and
 * the pause control. Everything shown comes from the agent's workspace and charter, and
 * every queue reads through a `WorkbenchDataSource`. The shipped source reports "not
 * available" because the engine tables are not applied; nothing here invents rows.
 *
 * Quick actions are descriptions, never buttons that act. A navigation action (view runs,
 * review proposals) is enabled because it only opens a read-only panel. An action that would
 * change something (ask for a draft, pause) is disabled with the reason until the path that
 * performs it exists and has been approved.
 */
import {
  authorizePauseChange,
  PAUSE_CAPABILITY,
  type PauseSubject,
} from "../workforce-pause/pause-policy";
import { workforceRoster, type WorkforceMember } from "../workforce-charter/roster";
import type { AgentWorkspace } from "../workforce-charter/workspace";
import { ENGINE_TABLES_NOTE } from "./workforce-view";

export type QueueState =
  | {
      readonly available: true;
      readonly items: readonly {
        readonly id: string;
        readonly title: string;
        readonly detail: string | null;
        readonly at: string;
      }[];
    }
  | { readonly available: false; readonly reason: string };

export interface WorkbenchDataSource {
  queue(agentCode: string, queueId: string, source: string): Promise<QueueState>;
}

export const UNAVAILABLE_SOURCE: WorkbenchDataSource = {
  queue: async () => ({ available: false, reason: ENGINE_TABLES_NOTE }),
};

type QuickActionKind = AgentWorkspace["ui"]["quickActions"][number]["kind"];

const ACTION_EFFECTS: Readonly<Record<QuickActionKind, string>> = {
  ask_for_draft:
    "Asks the agent for a draft. It lands in the proposals queue for review; nothing is sent.",
  view_runs: "Opens this agent's recent runs. Read only.",
  review_proposals: "Opens this agent's proposals and who has to approve each. Read only.",
  pause_agent: "Holds this agent in shadow and stops it reading data until the sheriff resumes it.",
};

const NAVIGATION: ReadonlySet<QuickActionKind> = new Set(["view_runs", "review_proposals"]);
const ANCHORS: Partial<Record<QuickActionKind, string>> = {
  view_runs: "panel-runs",
  review_proposals: "panel-proposals",
};

const DISABLED_REASONS: Readonly<Record<QuickActionKind, string>> = {
  ask_for_draft: "Not available until the engine tables exist and the request path is approved.",
  view_runs: "",
  review_proposals: "",
  pause_agent:
    "Awaiting the owner's approval of the pause design (ADR-094) and its database tables.",
};

export interface QuickActionView {
  readonly id: string;
  readonly label: string;
  readonly kind: QuickActionKind;
  readonly effect: string;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  /** In-page anchor on the agent dashboard, for navigation actions. */
  readonly anchor: string | null;
}

export interface PauseControlView {
  readonly available: false;
  readonly reason: string;
  /** Derived from the pause policy, not written by hand. */
  readonly pauseNeeds: "operations capability" | "the sheriff";
  readonly resumeNeeds: "the sheriff";
  readonly reach: string;
}

export interface WorkbenchView {
  readonly code: string;
  readonly codename: string;
  readonly title: string;
  readonly kind: AgentWorkspace["ui"]["workbench"];
  readonly headline: string;
  readonly emptyState: string;
  readonly queues: readonly {
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly state: QueueState;
  }[];
  readonly quickActions: readonly QuickActionView[];
  readonly pause: PauseControlView;
}

const subjectOf = (m: WorkforceMember): PauseSubject => ({
  packCode: m.charter.packCode,
  agentTier: m.charter.agentTier,
  killScope: m.charter.killScope,
});

function pauseView(member: WorkforceMember, roster: readonly WorkforceMember[]): PauseControlView {
  const subjects = roster.map(subjectOf);
  const ops = { isSheriff: false, capabilities: new Set<string>([PAUSE_CAPABILITY]) };
  const decision = authorizePauseChange(
    ops,
    { action: "pause", target: member.charter.packCode, reason: "a long enough reason" },
    subjects,
  );
  const tier = member.charter.agentTier;
  const reach =
    member.charter.killScope !== "agent"
      ? "Pausing it also pauses every agent except the assurance agents."
      : tier === "assurance"
        ? "It is paused only on its own; a wider pause never silences it."
        : "Pausing it affects this agent only.";
  return {
    available: false,
    reason:
      "Not available: the pause design awaits the owner's approval and its tables are not applied.",
    pauseNeeds: decision.allowed ? "operations capability" : "the sheriff",
    resumeNeeds: "the sheriff",
    reach,
  };
}

export async function buildWorkbench(
  code: string,
  source: WorkbenchDataSource = UNAVAILABLE_SOURCE,
  roster: readonly WorkforceMember[] = workforceRoster(),
): Promise<WorkbenchView | null> {
  const member = roster.find((m) => m.pack.code === code);
  if (!member) return null;
  const ui = member.workspace.ui;
  const known = new Set(member.workspace.scopes.map((s) => s.resource));

  const queues = await Promise.all(
    ui.queues.map(async (q) => {
      let state: QueueState;
      if (!known.has(q.source)) {
        // A queue may only read what the agent's workspace lists.
        state = {
          available: false,
          reason: "Not available: this agent's workspace does not include that data.",
        };
      } else {
        try {
          state = await source.queue(code, q.id, q.source);
        } catch {
          state = {
            available: false,
            reason: "Not available: the data could not be read just now.",
          };
        }
      }
      return { id: q.id, title: q.title, source: q.source, state };
    }),
  );

  return {
    code,
    codename: member.charter.codename,
    title: member.pack.title,
    kind: ui.workbench,
    headline: ui.headline,
    emptyState: ui.emptyState,
    queues,
    quickActions: ui.quickActions.map((a) => {
      const enabled = NAVIGATION.has(a.kind);
      return {
        id: a.id,
        label: a.label,
        kind: a.kind,
        effect: ACTION_EFFECTS[a.kind],
        enabled,
        disabledReason: enabled ? null : DISABLED_REASONS[a.kind],
        anchor: enabled ? (ANCHORS[a.kind] ?? null) : null,
      };
    }),
    pause: pauseView(member, roster),
  };
}
