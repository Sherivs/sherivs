/**
 * Capability bindings (ENGINE-05, ADR-083): what each pack capability DOES when a
 * playbook reaches it. A capability is either backed by a brokered tool or by an
 * internal handler. Internal handlers are limited to T0 and T1: anything
 * customer-visible, public, financial or production-affecting must be a tool, so
 * it passes the broker and leaves a ledger row.
 */
import type { RolePack } from "../twin-engine/role-pack";
import { tierRank } from "../twin-engine/role-pack";
import { toolById } from "../tool-broker/platform-tools";

export type Binding =
  | { readonly kind: "tool"; readonly toolId: string }
  | { readonly kind: "internal"; readonly handlerId: string };

export type BindingTable = Readonly<Record<string, Binding>>;

/** Bindings for the JARVIS executive pack (ENGINE-04). */
export const JARVIS_BINDINGS: BindingTable = Object.freeze({
  "observe.platform": { kind: "internal", handlerId: "executive.observe" },
  "assess.workforce": { kind: "internal", handlerId: "executive.assess" },
  "draft.social.post": { kind: "internal", handlerId: "executive.draft_social" },
  "coordinate.workforce": { kind: "internal", handlerId: "executive.coordinate" },
  "demote.capability": { kind: "internal", handlerId: "executive.demote" },
  "pause.agent": { kind: "internal", handlerId: "executive.pause" },
  "notify.owner": { kind: "tool", toolId: "owner.alert.send" },
  "send.customer.message": { kind: "tool", toolId: "whatsapp.send.customer" },
  "publish.social.post": { kind: "tool", toolId: "social.post.publish" },
  "request.deploy": { kind: "tool", toolId: "vercel.deploy.request" },
  "request.refund": { kind: "tool", toolId: "payments.refund.issue" },
  "request.access.grant": { kind: "tool", toolId: "iam.access.grant" },
} as const);

/** Findings for a pack and its binding table. Empty means every capability is safely bound. */
export function validateBindings(pack: RolePack, table: BindingTable): readonly string[] {
  const findings: string[] = [];
  const ids = new Set(pack.capabilities.map((c) => c.id));
  for (const id of Object.keys(table))
    if (!ids.has(id)) findings.push(`binding for unknown capability ${id}`);
  for (const cap of pack.capabilities) {
    const b = table[cap.id];
    if (!b) {
      findings.push(`capability ${cap.id} has no binding`);
      continue;
    }
    if (b.kind === "internal") {
      if (tierRank(cap.tier) > tierRank("T1"))
        findings.push(`${cap.id}: internal handlers are limited to T1`);
      if (cap.connector !== undefined)
        findings.push(`${cap.id}: a connector capability must be a tool binding`);
      continue;
    }
    const tool = toolById(b.toolId);
    if (!tool) {
      findings.push(`${cap.id}: unknown tool ${b.toolId}`);
      continue;
    }
    if (cap.connector !== undefined && cap.connector !== tool.connector) {
      findings.push(
        `${cap.id}: tool connector ${tool.connector} differs from capability connector ${cap.connector}`,
      );
    }
    if (tierRank(tool.tier) > tierRank(cap.tier)) {
      findings.push(`${cap.id}: tool tier ${tool.tier} exceeds capability tier ${cap.tier}`);
    }
  }
  return findings;
}
