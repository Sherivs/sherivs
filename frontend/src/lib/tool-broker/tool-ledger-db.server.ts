/**
 * DB-backed tool ledger (ENGINE-06, ADR-084): implements the broker's `LedgerPort`
 * and the execution gate's `GateLedgerPort` over `cg_tool_call_ledger`
 * (migration 20261110000300, AUTHORED, NOT APPLIED).
 *
 * Runs on the service-role client: the table is deny-by-default for clients.
 * Every row read back is Zod-validated, and any persistence error throws so the
 * callers (which fail closed) refuse the call. Until the migration is applied
 * every operation throws; nothing is faked in application code.
 *
 * The decision row's `approver_kind` records the approver the decision REQUIRES;
 * an outcome row's `approver_kind` records who actually approved.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LoadedDecision, GateLedgerPort } from "../connector-adapters/execution-gate.server";
import type { Decision, DenyCode, Verdict } from "./broker";
import { VERDICTS } from "./broker";
import type { DecisionRecord, LedgerPort } from "./broker-service.server";
import { ROLE_PACK_TIERS } from "../twin-engine/role-pack";

export type ToolLedgerClient = SupabaseClient;
const TABLE = "cg_tool_call_ledger" as const;
const UNIQUE_VIOLATION = "23505";

const approver = z.enum(["role_owner", "platform_staff", "sheriff"]);
const decisionRow = z
  .object({
    id: z.string().min(1),
    verdict: z.enum(VERDICTS),
    tier: z.enum(ROLE_PACK_TIERS),
    deny_code: z.string().nullable(),
    reasons: z.array(z.string()),
    args_digest: z.string().regex(/^[0-9a-f]{64}$/),
    approver_kind: approver.nullable(),
  })
  .passthrough();
const loadedRow = decisionRow.extend({
  twin_context_id: z.string().min(1),
  tenant_ref: z.string().min(1),
  tool_id: z.string().min(1),
  tool_version: z.string().min(1),
  kind: z.literal("decision"),
  twin_context: z.object({ context_kind: z.enum(["tenant_membership", "platform_staff"]) }),
});

function fail(op: string, e: { message?: string } | null): never {
  throw new Error(`tool ledger ${op} failed: ${e?.message ?? "unknown"}`);
}

function toDecision(r: z.infer<typeof decisionRow>): Decision {
  return {
    verdict: r.verdict,
    tier: r.tier,
    reasons: r.reasons,
    ...(r.deny_code ? { denyCode: r.deny_code as DenyCode } : {}),
    ...(r.approver_kind ? { approver: r.approver_kind } : {}),
  };
}

export function createToolLedgerDb(client: ToolLedgerClient): LedgerPort & GateLedgerPort {
  const findByKey = async (i: {
    twinContextId: string;
    toolId: string;
    idempotencyKey: string;
  }): Promise<DecisionRecord | null> => {
    const { data, error } = await client
      .from(TABLE)
      .select("id,verdict,tier,deny_code,reasons,args_digest,approver_kind")
      .eq("kind", "decision")
      .eq("twin_context_id", i.twinContextId)
      .eq("tool_id", i.toolId)
      .eq("idempotency_key", i.idempotencyKey)
      .maybeSingle();
    if (error) fail("find", error);
    if (!data) return null;
    const row = decisionRow.parse(data);
    return { id: row.id, decision: toDecision(row), argsDigest: row.args_digest };
  };

  return {
    findDecision: findByKey,

    async appendDecision(i) {
      const row = {
        kind: "decision",
        twin_context_id: i.twinContextId,
        tenant_ref: i.tenantRef,
        tool_id: i.tool.id,
        tool_version: i.tool.version,
        tier: i.decision.tier,
        verdict: i.decision.verdict as Verdict,
        deny_code: i.decision.denyCode ?? null,
        reasons: [...i.decision.reasons],
        args_digest: i.argsDigest,
        args_redacted: i.argsRedacted ?? {},
        idempotency_key: i.idempotencyKey ?? null,
        approver_kind: i.decision.approver ?? null,
      };
      const { data, error } = await client.from(TABLE).insert(row).select("id").single();
      if (error) {
        // A concurrent call with the same key won the race: return its row, never a second one.
        if ((error as { code?: string }).code === UNIQUE_VIOLATION && i.idempotencyKey) {
          const prior = await findByKey({
            twinContextId: i.twinContextId,
            toolId: i.tool.id,
            idempotencyKey: i.idempotencyKey,
          });
          if (prior) return { id: prior.id };
        }
        fail("append decision", error);
      }
      return { id: z.object({ id: z.string().min(1) }).parse(data).id };
    },

    async loadDecision(decisionId): Promise<LoadedDecision | null> {
      const { data, error } = await client
        .from(TABLE)
        .select(
          "id,verdict,tier,deny_code,reasons,args_digest,approver_kind,twin_context_id,tenant_ref,tool_id,tool_version,kind,twin_context:cg_twin_context(context_kind)",
        )
        .eq("id", decisionId)
        .eq("kind", "decision")
        .maybeSingle();
      if (error) fail("load", error);
      if (!data) return null;
      const r = loadedRow.parse(data);
      return {
        id: r.id,
        twinContextId: r.twin_context_id,
        tenantRef: r.tenant_ref,
        contextKind: r.twin_context.context_kind,
        toolId: r.tool_id,
        toolVersion: r.tool_version,
        tier: r.tier,
        verdict: r.verdict,
        argsDigest: r.args_digest,
      };
    },

    async hasSucceeded(decisionId) {
      const { data, error } = await client
        .from(TABLE)
        .select("id")
        .eq("kind", "outcome")
        .eq("parent_id", decisionId)
        .eq("outcome", "succeeded")
        .limit(1);
      if (error) fail("check success", error);
      return Array.isArray(data) && data.length > 0;
    },

    async appendOutcome({ decision, outcome, approval }) {
      const { data, error } = await client
        .from(TABLE)
        .insert({
          kind: "outcome",
          parent_id: decision.id,
          twin_context_id: decision.twinContextId,
          tenant_ref: decision.tenantRef,
          tool_id: decision.toolId,
          tool_version: decision.toolVersion,
          tier: decision.tier,
          args_digest: decision.argsDigest,
          outcome,
          approval_ref: approval?.approvalRef ?? null,
          approver_kind: approval?.approverKind ?? null,
        })
        .select("id")
        .single();
      if (error) fail("append outcome", error);
      return { id: z.object({ id: z.string().min(1) }).parse(data).id };
    },
  };
}
