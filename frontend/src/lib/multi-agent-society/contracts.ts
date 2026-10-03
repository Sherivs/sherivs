/**
 * CoreGrid — phase 35 Autonomous Agent Civilization OS: governed
 * multi-agent society contracts (H3 wave Squad G, mission G-055,
 * Contract Architect).
 *
 * WHAT: the typed substrate surface for what phase 35 is DECLARED to own
 * (kernel contract `kernel/phase-contracts/phase-35-agent-civilization.ts`,
 * capability `multi-agent-society-governance`):
 *
 * - `society:form`     — bounded, tenant-scoped society definitions (command)
 * - `society:coordinate` — inter-agent coordination and collective decision
 *                        rules, always attributable to individual members
 * - `society:audit`    — append-only society audit trail (query)
 *
 * Laws of this module (from the kernel contract's principle and AI-safety
 * section, and AGENTS §5/§21/§27/§28):
 *
 * - AGENTS ARE UNTRUSTED BY DEFAULT: a society is a governance structure over
 *   individually granted agents, never a source of authority itself.
 * - NO AGGREGATION INTO AUTHORITY: a society's collective authority is exactly
 *   the INTERSECTION of its members' declared grants. There is no union, no
 *   emergent escalation, no society-level permission. A member whose identity
 *   is not usable contributes an EMPTY grant set — the intersection collapses
 *   to nothing rather than silently widening (fail closed on both shrink and
 *   grow: authority may only ever shrink).
 * - TOTAL ATTRIBUTION: every coordination message, vote and audit entry names
 *   the individual agents involved. Anonymous collective action is denied.
 * - UNTRUSTED COLLECTIVE OUTPUT: collective output is unvalidated — and
 *   therefore authorizes nothing — until an explicit validation record from a
 *   participating member approves it.
 * - FAIL-CLOSED FORMATION: a society requires at least two members (a
 *   single-agent "society" duplicates the agent runtime, phase 07 territory),
 *   is bound to exactly one tenant (member records carry no tenant of their
 *   own — the society tenant binds them), and needs an explicit approval
 *   record to activate, re-activate or dissolve.
 * - SUSPENSION WITHOUT COLLATERAL: a society can be suspended as a unit (its
 *   member records remain untouched) or per member; a dissolved society is
 *   terminal.
 * - BOUNDED: ids and refs are trimmed, non-blank, at most 160 characters,
 *   control-character free; societies are bounded at 1024 members, ballots at
 *   4096 votes, trails at 65536 entries.
 *
 * Boundary (kernel `excludes` + D6): this module NEVER creates agents, NEVER
 * widens or issues grants, NEVER decides authorization (phase 08), NEVER
 * touches model providers (phase 26) and NEVER self-improves (phase 47).
 * Member grants here are DECLARED VIEWS supplied by the caller; the records
 * that own them are never mutated.
 *
 * Composition (read-only): member participation is gated through the
 * platform identity primitive `isIdentityUsable` (`../identity`) — a member
 * in a suspended/deleted/archived identity lifecycle does not participate.
 * No sibling H3 module is imported.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets, no execution.
 *
 * Neutral vocabulary only (J-037 shrink-only): a "society" is any bounded
 * set of governed actors; a "member" is one governed actor in that set. No
 * domain vocabulary appears here.
 */

import { z } from "zod";
import { isIdentityUsable, type IdentityLifecycleState } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export const MULTI_AGENT_SOCIETY_SCHEMA_VERSION = "1.0";

const REF_MAX = 160;
const MAX_MEMBERS = 1_024;
const MAX_BALLOT = 4_096;
const MAX_TRAIL = 65_536;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function refSchema(label: string) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .max(REF_MAX, `${label} must be at most ${REF_MAX} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .refine((value) => value === value.trim(), `${label} must not have leading or trailing whitespace`)
    .refine((value) => !CONTROL_CHARS.test(value), `${label} must not contain control characters`);
}

export const societyRefSchema = refSchema("societyRef");
export const actorRefSchema = refSchema("actorRef");
export const tenantRefSchema = refSchema("tenantRef");
export const actionRefSchema = refSchema("actionRef");
export const correlationRefSchema = refSchema("correlationRef");

export type SocietyRef = z.infer<typeof societyRefSchema>;
export type ActorRef = z.infer<typeof actorRefSchema>;
export type TenantRef = z.infer<typeof tenantRefSchema>;
export type ActionRef = z.infer<typeof actionRefSchema>;

/** Why a member is in the society — provenance of the demand (AGENTS §12). */
export const memberRoleSchema = z.enum(["participant", "coordinator", "observer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

/**
 * One member: an individually governed actor and the declared grant view
 * this society may rely on. `grants` are action ids the member holds
 * ELSEWHERE (agent runtime / authorization layer); a member with an empty
 * grant list holds zero society authority — nothing is assumed.
 */
export const societyMemberSchema = z.strictObject({
  memberRef: actorRefSchema,
  /** Identity lifecycle of the member actor, evaluated with `isIdentityUsable`. */
  identityLifecycle: z.enum([
    "proposed",
    "review",
    "provisioned",
    "active",
    "suspended",
    "deleted",
    "archived",
  ] satisfies readonly IdentityLifecycleState[]),
  role: memberRoleSchema,
  /** Declared grant view (action ids) — intersection input, never issued here. */
  grants: z.array(actionRefSchema).max(MAX_BALLOT),
});

export type SocietyMember = z.infer<typeof societyMemberSchema>;

/** Society lifecycle — distinct from (and never overriding) agent lifecycle. */
export const societyLifecycleSchema = z.enum(["proposed", "active", "suspended", "dissolved", "rejected"]);
export type SocietyLifecycleState = z.infer<typeof societyLifecycleSchema>;

/** Provenance block: who declared this record, under what authority, when. */
export const provenanceSchema = z.strictObject({
  declaredBy: refSchema("declaredBy"),
  declaredAt: z.string().min(1).max(REF_MAX),
  authority: z.string().min(1).max(REF_MAX),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * A society definition (`society:form`). Parsed state is always `proposed`;
 * activation is a separate, approval-gated lifecycle transition.
 */
export const societyDefinitionSchema = z.strictObject({
  societyRef: societyRefSchema,
  /** Every member lives in exactly this tenant — a society is tenant-scoped. */
  tenantRef: tenantRefSchema,
  purpose: z.string().min(1, "purpose must be a non-empty string").max(500),
  members: z
    .array(societyMemberSchema)
    .min(2, "a society requires at least two members — a one-member society duplicates the agent runtime and is denied")
    .max(MAX_MEMBERS),
  provenance: provenanceSchema,
});
export type SocietyDefinition = z.infer<typeof societyDefinitionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial societies)
 * ────────────────────────────────────────────────────────────*/

export type SocietyParseFailureReason =
  | "invalid_shape"
  | "cross_record_invariant";

export interface SocietyParseIssue {
  readonly path: string;
  readonly message: string;
}

export type SocietyParseResult =
  | { readonly ok: true; readonly society: SocietyDefinition }
  | {
      readonly ok: false;
      readonly reason: SocietyParseFailureReason;
      readonly issues: readonly SocietyParseIssue[];
    };

function issueList(error: z.ZodError): readonly SocietyParseIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "(root)" : issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

/**
 * Parse an untrusted input into a society definition. Cross-record
 * invariants (duplicate members, cross-tenant members) deny the WHOLE
 * definition — a failed parse never yields a partial society.
 */
export function parseSocietyDefinition(input: unknown): SocietyParseResult {
  const parsed = societyDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_shape", issues: issueList(parsed.error) };
  }

  const society = parsed.data;
  const issues: SocietyParseIssue[] = [];
  const seen = new Set<string>();
  for (const member of society.members) {
    if (seen.has(member.memberRef)) {
      issues.push({
        path: `members[memberRef=${member.memberRef}]`,
        message: `duplicate member "${member.memberRef}" — one actor holds exactly one seat`,
      });
    } else {
      seen.add(member.memberRef);
    }
  }
  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }
  return { ok: true, society };
}

/* ─────────────────────────────────────────────────────────────
 * Society lifecycle (approval-gated, fail closed)
 * ────────────────────────────────────────────────────────────*/

export const FAIL_CLOSED_LIFECYCLE_DETAIL =
  "fail-closed society lifecycle: activation and re-activation require an explicit approval record; dissolved is terminal; every non-listed transition denies";

export const societyApprovalSchema = z.strictObject({
  approvalRef: refSchema("approvalRef"),
  approvedBy: refSchema("approvedBy"),
});
export type SocietyApproval = z.infer<typeof societyApprovalSchema>;

export type SocietyTransitionCode =
  | "transition_not_listed"
  | "approval_required";

export type SocietyTransitionResult =
  | { readonly ok: true; readonly state: SocietyLifecycleState }
  | { readonly ok: false; readonly code: SocietyTransitionCode; readonly detail: string };

const SOCIETY_TRANSITIONS: Readonly<
  Record<SocietyLifecycleState, readonly { to: SocietyLifecycleState; requiresApproval: boolean }[]>
> = {
  proposed: [{ to: "active", requiresApproval: true }, { to: "rejected", requiresApproval: false }],
  active: [
    { to: "suspended", requiresApproval: false },
    { to: "dissolved", requiresApproval: true },
  ],
  suspended: [
    { to: "active", requiresApproval: true },
    { to: "dissolved", requiresApproval: true },
  ],
  rejected: [],
  dissolved: [],
};

/** Societies operate only in `active` state — every other state coordinates nothing. */
export function isSocietyOperational(society: SocietyLifecycleState): boolean {
  return society === "active";
}

/**
 * Move a society through its lifecycle. The society record carries its state
 * in `provenance.declaredAt`-adjacent tracking by the caller; transitions are
 * pure and stateless: the CURRENT state is an explicit argument, the caller
 * persists the outcome.
 */
export function transitionSociety(
  from: SocietyLifecycleState,
  to: SocietyLifecycleState,
  approval: SocietyApproval | null,
): SocietyTransitionResult {
  const transition = SOCIETY_TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (!transition) {
    return {
      ok: false,
      code: "transition_not_listed",
      detail: `society lifecycle transition ${from} → ${to} is not listed — ${FAIL_CLOSED_LIFECYCLE_DETAIL}`,
    };
  }
  if (transition.requiresApproval && approval === null) {
    return {
      ok: false,
      code: "approval_required",
      detail: `society lifecycle transition ${from} → ${to} requires an explicit approval record — ${FAIL_CLOSED_LIFECYCLE_DETAIL}`,
    };
  }
  return { ok: true, state: to };
}

/* ─────────────────────────────────────────────────────────────
 * Intersection-of-grants authority (the security core)
 * ────────────────────────────────────────────────────────────*/

export const FAIL_CLOSED_INTERSECTION_DETAIL =
  "fail-closed collective authority: a society may act only where EVERY member's declared grants include the action; an unusable member contributes an empty grant set, so authority can shrink but never widen";

export type CollectiveAuthorityCode =
  | "society_not_active"
  | "action_not_in_intersection";

export type CollectiveAuthorityResult =
  | { readonly ok: true; readonly actionRef: ActionRef; readonly heldBy: readonly ActorRef[] }
  | {
      readonly ok: false;
      readonly code: CollectiveAuthorityCode;
      readonly actionRef: ActionRef;
      /** Members whose effective grant set lacks the action (fail-closed enumeration). */
      readonly missingFrom: readonly ActorRef[];
      readonly detail: string;
    };

/**
 * A member's effective grant view: the declared grants when the member's
 * identity is usable, EMPTY otherwise. This is the fail-closed direction —
 * an unusable member must never be silently dropped from the intersection,
 * because dropping a member can only WIDEN what remains.
 */
export function effectiveMemberGrants(member: SocietyMember): readonly ActionRef[] {
  return isIdentityUsable({ lifecycle: member.identityLifecycle }) ? member.grants : [];
}

/**
 * The society's total authority: the intersection of all members' effective
 * grant sets. An empty result is the normal, safe default — a society with
 * zero common grants can coordinate nothing.
 */
export function societyAuthorityIntersection(
  members: readonly SocietyMember[],
): readonly ActionRef[] {
  if (members.length === 0) return [];
  let intersection: Set<ActionRef> | null = null;
  for (const member of members) {
    const grants = new Set(effectiveMemberGrants(member));
    if (intersection === null) {
      intersection = grants;
    } else {
      for (const action of [...intersection]) {
        if (!grants.has(action)) intersection.delete(action);
      }
    }
    if (intersection.size === 0) return [];
  }
  return [...(intersection ?? new Set<ActionRef>())];
}

/**
 * THE collective-action gate: may THIS society perform THIS action? Fails
 * closed on every non-active state and on every action not in the
 * intersection, naming exactly which members lack the grant.
 */
export function evaluateCollectiveAction(
  society: SocietyDefinition,
  state: SocietyLifecycleState,
  actionRef: ActionRef,
): CollectiveAuthorityResult {
  if (!isSocietyOperational(state)) {
    return {
      ok: false,
      code: "society_not_active",
      actionRef,
      missingFrom: [],
      detail: `society "${society.societyRef}" is ${state} — only an active society may perform collective actions`,
    };
  }
  const missingFrom = society.members
    .filter((member) => !effectiveMemberGrants(member).includes(actionRef))
    .map((member) => member.memberRef);
  if (missingFrom.length > 0) {
    return {
      ok: false,
      code: "action_not_in_intersection",
      actionRef,
      missingFrom,
      detail: FAIL_CLOSED_INTERSECTION_DETAIL,
    };
  }
  return { ok: true, actionRef, heldBy: society.members.map((member) => member.memberRef) };
}

/* ─────────────────────────────────────────────────────────────
 * Coordination (`society:coordinate`) — attributable, tenant-bound
 * ────────────────────────────────────────────────────────────*/

export const coordinationKindSchema = z.enum(["message", "request", "response", "negotiation"]);
export type CoordinationKind = z.infer<typeof coordinationKindSchema>;

export const coordinationMessageSchema = z.strictObject({
  societyRef: societyRefSchema,
  fromRef: actorRefSchema,
  toRef: actorRefSchema,
  kind: coordinationKindSchema,
  purpose: z.string().min(1, "purpose must be a non-empty string").max(500),
  correlationRef: correlationRefSchema,
});
export type CoordinationMessage = z.infer<typeof coordinationMessageSchema>;

export type CoordinationCode =
  | "society_not_active"
  | "society_mismatch"
  | "unknown_sender"
  | "unknown_recipient"
  | "sender_not_participating"
  | "recipient_not_participating";

export type CoordinationResult =
  | { readonly ok: true; readonly message: CoordinationMessage; readonly attributedTo: readonly ActorRef[] }
  | {
      readonly ok: false;
      readonly code: CoordinationCode;
      readonly detail: string;
    };

/**
 * Evaluate one inter-agent coordination message against a society's
 * membership and operating state. Both endpoints must be current members
 * with usable identities — coordination between agents the society cannot
 * attribute is denied. A society that is not active coordinates nothing.
 */
export function evaluateCoordination(
  society: SocietyDefinition,
  state: SocietyLifecycleState,
  message: CoordinationMessage,
): CoordinationResult {
  if (!isSocietyOperational(state)) {
    return {
      ok: false,
      code: "society_not_active",
      detail: `society "${society.societyRef}" is ${state} — coordination is denied outside the active state`,
    };
  }
  if (message.societyRef !== society.societyRef) {
    return {
      ok: false,
      code: "society_mismatch",
      detail: `message targets society "${message.societyRef}" but was evaluated against "${society.societyRef}"`,
    };
  }
  const byRef = new Map(society.members.map((member) => [member.memberRef, member]));
  const sender = byRef.get(message.fromRef);
  if (sender === undefined) {
    return {
      ok: false,
      code: "unknown_sender",
      detail: `sender "${message.fromRef}" is not a member of society "${society.societyRef}" — unattributable coordination is denied`,
    };
  }
  const recipient = byRef.get(message.toRef);
  if (recipient === undefined) {
    return {
      ok: false,
      code: "unknown_recipient",
      detail: `recipient "${message.toRef}" is not a member of society "${society.societyRef}" — coordination outside the declared membership is denied`,
    };
  }
  if (!isIdentityUsable({ lifecycle: sender.identityLifecycle })) {
    return {
      ok: false,
      code: "sender_not_participating",
      detail: `sender "${message.fromRef}" is in lifecycle "${sender.identityLifecycle}" and does not participate`,
    };
  }
  if (!isIdentityUsable({ lifecycle: recipient.identityLifecycle })) {
    return {
      ok: false,
      code: "recipient_not_participating",
      detail: `recipient "${message.toRef}" is in lifecycle "${recipient.identityLifecycle}" and does not participate`,
    };
  }
  return {
    ok: true,
    message,
    attributedTo: [message.fromRef, message.toRef],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Collective decision rules (votes are attributable; no quorum, no verdict)
 * ────────────────────────────────────────────────────────────*/

export const voteChoiceSchema = z.enum(["affirm", "reject", "abstain"]);
export type VoteChoice = z.infer<typeof voteChoiceSchema>;

export const ballotEntrySchema = z.strictObject({
  voterRef: actorRefSchema,
  choice: voteChoiceSchema,
  rationale: z.string().min(1, "rationale must be a non-empty string").max(500),
});
export type BallotEntry = z.infer<typeof ballotEntrySchema>;

export const decisionRuleSchema = z.enum(["unanimous", "majority"]);
export type DecisionRule = z.infer<typeof decisionRuleSchema>;

export const collectiveDecisionSchema = z.strictObject({
  societyRef: societyRefSchema,
  topic: z.string().min(1, "topic must be a non-empty string").max(500),
  rule: decisionRuleSchema,
  /**
   * Explicit participation floor. Optional: when omitted the floor defaults
   * to the FULL participating membership (silence counts against agreement).
   * When declared it must be at least half of the participating membership —
   * a caller cannot vote-shrink its way to a quorum.
   */
  quorumFloor: z.number().int().min(1).max(MAX_MEMBERS).optional(),
  ballot: z.array(ballotEntrySchema).max(MAX_BALLOT),
});
export type CollectiveDecision = z.infer<typeof collectiveDecisionSchema>;

export type CollectiveVerdict = "agreed" | "no_agreement";

export type CollectiveDecisionCode =
  | "society_not_active"
  | "society_mismatch"
  | "empty_ballot"
  | "unknown_voter"
  | "duplicate_vote"
  | "quorum_below_floor";

export type CollectiveDecisionResult =
  | {
      readonly ok: true;
      readonly verdict: CollectiveVerdict;
      readonly rule: DecisionRule;
      readonly quorumFloor: number;
      readonly participatingCount: number;
      readonly attributedTo: readonly ActorRef[];
    }
  | {
      readonly ok: false;
      readonly code: CollectiveDecisionCode;
      readonly detail: string;
    };

/**
 * Participating members: current members whose identity is usable. Observers
 * participate in speech (coordination) but hold no vote in collective
 * decisions — collective decision rules are made by participants.
 */
export function participatingMembers(members: readonly SocietyMember[]): readonly SocietyMember[] {
  return members.filter(
    (member) => member.role !== "observer" && isIdentityUsable({ lifecycle: member.identityLifecycle }),
  );
}

function participationFloor(participatingCount: number): number {
  return Math.max(1, Math.ceil(participatingCount / 2));
}

/**
 * Resolve a collective decision. Fail closed:
 * - only active societies decide;
 * - only participating members may vote (unknown voters deny);
 * - one vote per member (duplicates deny);
 * - the quorum floor can never go below half the participating membership;
 * - `unanimous` requires every participating member to cast `affirm` —
 *   silence, abstention or rejection each break unanimity;
 * - `majority` requires affirm > reject among cast votes AND cast ≥ floor —
 *   ties resolve to `no_agreement`.
 * An `agreed` verdict governs the society's own coordination posture only —
 * it NEVER widens authority; collective actions remain gated by the
 * intersection of grants, always.
 */
export function resolveCollectiveDecision(
  society: SocietyDefinition,
  state: SocietyLifecycleState,
  decision: CollectiveDecision,
): CollectiveDecisionResult {
  if (!isSocietyOperational(state)) {
    return {
      ok: false,
      code: "society_not_active",
      detail: `society "${society.societyRef}" is ${state} — collective decisions are denied outside the active state`,
    };
  }
  if (decision.societyRef !== society.societyRef) {
    return {
      ok: false,
      code: "society_mismatch",
      detail: `decision targets society "${decision.societyRef}" but was evaluated against "${society.societyRef}"`,
    };
  }
  const participants = participatingMembers(society.members);
  const participantRefs = new Set(participants.map((member) => member.memberRef));
  const floor = decision.quorumFloor ?? participants.length;
  if (floor < participationFloor(participants.length)) {
    return {
      ok: false,
      code: "quorum_below_floor",
      detail: `declared quorum floor ${floor} is below the participation floor ${participationFloor(participants.length)} of ${participants.length} participating members — a quorum cannot be voted below half the participation`,
    };
  }
  if (decision.ballot.length === 0) {
    return {
      ok: false,
      code: "empty_ballot",
      detail: "an empty ballot decides nothing — at least one attributable vote is required",
    };
  }
  const seen = new Set<ActorRef>();
  for (const entry of decision.ballot) {
    if (seen.has(entry.voterRef)) {
      return {
        ok: false,
        code: "duplicate_vote",
        detail: `voter "${entry.voterRef}" cast more than one vote — one member, one vote`,
      };
    }
    seen.add(entry.voterRef);
    if (!participantRefs.has(entry.voterRef)) {
      return {
        ok: false,
        code: "unknown_voter",
        detail: `voter "${entry.voterRef}" is not a participating member of society "${society.societyRef}" — only attributable participants vote`,
      };
    }
  }
  const castCount = decision.ballot.length;
  if (castCount < floor) {
    return {
      ok: false,
      code: "quorum_below_floor",
      detail: `ballot covers ${castCount} of ${participants.length} participating members, below the floor ${floor} — silence resolves to no agreement, never to agreement`,
    };
  }

  const affirm = decision.ballot.filter((entry) => entry.choice === "affirm").length;
  const reject = decision.ballot.filter((entry) => entry.choice === "reject").length;
  let verdict: CollectiveVerdict;
  if (decision.rule === "unanimous") {
    verdict = castCount === participants.length && reject === 0 && affirm === castCount ? "agreed" : "no_agreement";
  } else {
    verdict = affirm > reject && castCount >= floor ? "agreed" : "no_agreement";
  }
  return {
    ok: true,
    verdict,
    rule: decision.rule,
    quorumFloor: floor,
    participatingCount: participants.length,
    attributedTo: decision.ballot.map((entry) => entry.voterRef),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Collective output trust (AGENTS §21: AI output is untrusted by default)
 * ────────────────────────────────────────────────────────────*/

export const collectiveOutputSchema = z.strictObject({
  outputRef: refSchema("outputRef"),
  societyRef: societyRefSchema,
  correlationRef: correlationRefSchema,
  summary: z.string().min(1, "summary must be a non-empty string").max(500),
});
export type CollectiveOutput = z.infer<typeof collectiveOutputSchema>;

export const outputValidationSchema = z.strictObject({
  outputRef: refSchema("outputRef"),
  validatorRef: actorRefSchema,
  verdict: z.enum(["approved", "rejected"]),
  reason: z.string().min(1, "reason must be a non-empty string").max(500),
});
export type OutputValidation = z.infer<typeof outputValidationSchema>;

export interface CollectiveOutputRecord {
  readonly output: CollectiveOutput;
  /** Every society output begins unvalidated — and therefore unusable. */
  readonly validation: "unvalidated";
}

/**
 * Register collective output. The record is born UNVALIDATED: untrusted
 * output authorizes nothing, is executed nowhere and must not be treated as
 * canonical truth (kernel `canonicalTruth.derived`).
 */
export function registerCollectiveOutput(output: CollectiveOutput): CollectiveOutputRecord {
  return { output, validation: "unvalidated" };
}

export type OutputValidationCode =
  | "society_mismatch"
  | "unknown_validator"
  | "validator_not_participating";

export type OutputValidationResult =
  | { readonly ok: true; readonly trusted: boolean; readonly validatedBy: ActorRef }
  | { readonly ok: false; readonly code: OutputValidationCode; readonly detail: string };

/**
 * Apply a validation verdict to collective output. Only a participating
 * member may validate; only `approved` flips the output to trusted — a
 * rejected validation keeps the output unvalidated forever (fail closed).
 */
export function validateCollectiveOutput(
  society: SocietyDefinition,
  validation: OutputValidation,
): OutputValidationResult {
  const byRef = new Map(society.members.map((member) => [member.memberRef, member]));
  const validator = byRef.get(validation.validatorRef);
  if (validator === undefined) {
    return {
      ok: false,
      code: "unknown_validator",
      detail: `validator "${validation.validatorRef}" is not a member of society "${society.societyRef}" — unattributable validation is denied`,
    };
  }
  if (!isIdentityUsable({ lifecycle: validator.identityLifecycle })) {
    return {
      ok: false,
      code: "validator_not_participating",
      detail: `validator "${validation.validatorRef}" is in lifecycle "${validator.identityLifecycle}" and cannot validate`,
    };
  }
  return {
    ok: true,
    trusted: validation.verdict === "approved",
    validatedBy: validation.validatorRef,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Suspension (unit or per-member, without collateral damage)
 * ────────────────────────────────────────────────────────────*/

export const societySuspensionSchema = z.strictObject({
  societyRef: societyRefSchema,
  scope: z.enum(["society", "member"]),
  /** Required exactly when scope is `member`. */
  memberRef: actorRefSchema.optional(),
  reason: z.string().min(1, "reason must be a non-empty string").max(500),
  declaredBy: refSchema("declaredBy"),
});
export type SocietySuspension = z.infer<typeof societySuspensionSchema>;

export type SuspensionCode =
  | "society_not_active"
  | "society_mismatch"
  | "member_required"
  | "unknown_member";

export type SuspensionResult =
  | { readonly ok: true; readonly scope: "society" | "member"; readonly memberRef: ActorRef | null }
  | { readonly ok: false; readonly code: SuspensionCode; readonly detail: string };

/**
 * Apply a suspension decision. Society scope suspends the SOCIETY UNIT —
 * member records are returned untouched, so the unit can be suspended
 * without collateral damage to individual agents (kernel AI-safety law).
 * Member scope returns the member whose identity lifecycle the caller must
 * flip to `suspended`; through `effectiveMemberGrants` that member's grant
 * view collapses to empty, shrinking society authority — never widening it.
 */
export function applySocietySuspension(
  society: SocietyDefinition,
  state: SocietyLifecycleState,
  suspension: SocietySuspension,
): SuspensionResult {
  if (!isSocietyOperational(state)) {
    return {
      ok: false,
      code: "society_not_active",
      detail: `society "${society.societyRef}" is ${state} — suspension applies to an active society`,
    };
  }
  if (suspension.societyRef !== society.societyRef) {
    return {
      ok: false,
      code: "society_mismatch",
      detail: `suspension targets society "${suspension.societyRef}" but was evaluated against "${society.societyRef}"`,
    };
  }
  if (suspension.scope === "society") {
    if (suspension.memberRef !== undefined) {
      return {
        ok: false,
        code: "member_required",
        detail: "a society-scope suspension must not name a member — use member scope for per-member suspension",
      };
    }
    return { ok: true, scope: "society", memberRef: null };
  }
  if (suspension.memberRef === undefined) {
    return {
      ok: false,
      code: "member_required",
      detail: "a member-scope suspension must name exactly one memberRef",
    };
  }
  const byRef = new Map(society.members.map((member) => [member.memberRef, member]));
  if (!byRef.has(suspension.memberRef)) {
    return {
      ok: false,
      code: "unknown_member",
      detail: `member "${suspension.memberRef}" is not a member of society "${society.societyRef}"`,
    };
  }
  return { ok: true, scope: "member", memberRef: suspension.memberRef };
}

/* ─────────────────────────────────────────────────────────────
 * Society audit (`society:audit`) — append-only, fully attributed
 * ────────────────────────────────────────────────────────────*/

export const auditEntryKindSchema = z.enum([
  "formation",
  "coordination",
  "decision",
  "suspension",
  "output_validation",
  "dissolution",
]);
export type SocietyAuditEntryKind = z.infer<typeof auditEntryKindSchema>;

export const societyAuditEntrySchema = z.strictObject({
  entryId: refSchema("entryId"),
  societyRef: societyRefSchema,
  kind: auditEntryKindSchema,
  /**
   * The individual agents this entry is attributed to. At least one is
   * mandatory — a society NEVER acts anonymously (kernel observability law:
   * society-level actions decompose into per-agent audit entries).
   */
  attributedTo: z.array(actorRefSchema).min(1).max(MAX_BALLOT),
  summary: z.string().min(1, "summary must be a non-empty string").max(500),
});
export type SocietyAuditEntry = z.infer<typeof societyAuditEntrySchema>;

export type SocietyAuditParseFailureReason =
  | "invalid_shape"
  | "cross_record_invariant";

export type SocietyAuditParseResult =
  | { readonly ok: true; readonly entries: readonly SocietyAuditEntry[] }
  | {
      readonly ok: false;
      readonly reason: SocietyAuditParseFailureReason;
      readonly issues: readonly SocietyParseIssue[];
    };

/**
 * Parse an audit trail. The trail is append-only and immutable (AGENTS §28):
 * duplicate entry ids deny the whole trail — a failed parse never yields a
 * partial trail.
 */
export function parseSocietyAuditTrail(input: unknown): SocietyAuditParseResult {
  const parsed = z.array(societyAuditEntrySchema).max(MAX_TRAIL).safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_shape", issues: issueList(parsed.error) };
  }
  const issues: SocietyParseIssue[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (seen.has(entry.entryId)) {
      issues.push({
        path: `entries[entryId=${entry.entryId}]`,
        message: `duplicate audit entry "${entry.entryId}" — the trail is append-only and immutable`,
      });
    } else {
      seen.add(entry.entryId);
    }
  }
  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }
  return { ok: true, entries: parsed.data };
}