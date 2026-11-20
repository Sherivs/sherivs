/**
 * WF-07: the periodic approval sweep (ADR-122). Ports only, so it runs the same in the cron route,
 * in a unit test and in the sim e2e.
 *
 * Each pass does three things, in this order, and never lets one failure stop the others:
 *  1. Requests an approval for any draft that has none (a draft whose request failed at creation).
 *  2. Expires approvals past their window. An expired item cannot be decided any more; its run
 *     ends and its drafts become `expired`. Time is the database clock (`now()`), not this host's.
 *  3. Dispatches drafts whose approvals completed, then lets the waiting step continue. A dispatch
 *     that is refused (kill switch, live mode, a recipient who left, a template pulled) is counted
 *     and retried on the next pass; it is never forced. A draft whose executed record already exists
 *     but whose step is still waiting is only resumed (WF-08 follow-up: never dispatched twice). A
 *     failed dispatch is noted so the database lists that draft after the ones that have not failed,
 *     and a run of failing drafts cannot starve newer ones.
 *
 * No notification is sent from here. The inbox is pull-based in v1 (ADR-122), so the sweep sends
 * no message and calls no provider.
 */
export interface ApprovalSweepPorts {
  readonly rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: unknown } | null }>;
  readonly dispatchApprovedDraft: (orgId: string, draftId: string) => Promise<void>;
}

export interface ApprovalSweepCounts {
  readonly requested: number;
  readonly expired: number;
  readonly dispatched: number;
  readonly failed: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function runWorkflowApprovalSweep(
  ports: ApprovalSweepPorts,
  options: { limit?: number } = {},
): Promise<ApprovalSweepCounts> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  let requested = 0;
  let expired = 0;
  let dispatched = 0;
  let failed = 0;

  try {
    const r = await ports.rpc("wf_request_missing_draft_approvals", { p_limit: limit });
    if (r.error) failed += 1;
    else requested = num(r.data);
  } catch {
    failed += 1;
  }

  try {
    const r = await ports.rpc("wf_expire_approvals", { p_limit: limit });
    if (r.error) failed += 1;
    else {
      const row = (r.data ?? {}) as Record<string, unknown>;
      expired = num(row.approvals_expired) + num(row.orphan_drafts_expired);
    }
  } catch {
    failed += 1;
  }

  let ready: { org_id: string; draft_id: string; needs_dispatch: boolean }[] = [];
  try {
    const r = await ports.rpc("wf_approved_drafts_ready", { p_limit: limit });
    if (r.error || !Array.isArray(r.data)) failed += 1;
    else {
      ready = (r.data as Record<string, unknown>[]).flatMap((row) =>
        typeof row.org_id === "string" && typeof row.draft_id === "string"
          ? [
              {
                org_id: row.org_id,
                draft_id: row.draft_id,
                needs_dispatch: row.needs_dispatch !== false,
              },
            ]
          : [],
      );
    }
  } catch {
    failed += 1;
  }

  for (const item of ready) {
    let dispatching = item.needs_dispatch;
    try {
      if (item.needs_dispatch) await ports.dispatchApprovedDraft(item.org_id, item.draft_id);
      dispatching = false;
      const resumed = await ports.rpc("wf_resume_after_dispatch", {
        p_org: item.org_id,
        p_draft: item.draft_id,
      });
      if (resumed.error) failed += 1;
      else dispatched += 1;
    } catch {
      failed += 1;
      if (dispatching) {
        try {
          await ports.rpc("wf_note_draft_dispatch_failure", {
            p_org: item.org_id,
            p_draft: item.draft_id,
          });
        } catch {
          /* best effort: the draft is retried on the next pass either way */
        }
      }
    }
  }
  return { requested, expired, dispatched, failed };
}
