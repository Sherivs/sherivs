import { describe, expect, it } from "vitest";
import {
  decidePersistedApproval,
  type ApprovalDbClient,
  type DecidePersistedInput,
} from "../../frontend/src/lib/jarvis-bridge/approval-store.server";

type Row = Record<string, unknown>;
const NOW = "2026-11-16T10:30:00.000Z";

const pending = (over: Row = {}): Row => ({
  approval_id: "appr-1",
  idempotency_key: "k-1",
  action_id: "deploy.production",
  action_ref: "ref-1",
  agent_definition_id: "engineering-agent",
  requester_ref: "agent:engineering-agent",
  platform_ref: "coregrid",
  risk_tier: "T3",
  preconditions_digest: "digest-1",
  requested_at: "2026-11-16T10:00:00.000Z",
  expires_at: "2026-11-16T11:00:00.000Z",
  status: "pending",
  decided_by: null,
  decided_role: null,
  decided_at: null,
  passkey_step_up_verified: false,
  executed_at: null,
  ...over,
});

function fakeDb(row: Row | null, opts: { raceLost?: boolean; failRead?: boolean } = {}) {
  const requests: Row[] = row ? [{ ...row }] : [];
  const events: Row[] = [];
  const db: ApprovalDbClient = {
    from: (table: string) => {
      const rows = table === "jarvis_approval_requests" ? requests : events;
      return {
        select: () => {
          let found = [...rows];
          const q = {
            eq: (c: string, v: unknown) => ((found = found.filter((r) => r[c] === v)), q),
            order: () => q,
            limit: () => q,
            maybeSingle: () =>
              Promise.resolve(
                opts.failRead
                  ? { data: null, error: { message: "x" } }
                  : { data: found[0] ?? null, error: null },
              ),
            then: (ok: (v: unknown) => unknown) =>
              Promise.resolve(
                opts.failRead
                  ? { data: null, error: { message: "x" } }
                  : { data: found, error: null },
              ).then(ok),
          };
          return q as never;
        },
        insert: (list: Row[]) => {
          for (const e of list) events.push({ event_seq: events.length + 1, ...e });
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: Row) => ({
          eq: (c1: string, v1: unknown) => ({
            eq: (c2: string, v2: unknown) => ({
              select: () => {
                const hit = opts.raceLost
                  ? []
                  : requests.filter((r) => r[c1] === v1 && r[c2] === v2);
                for (const r of hit) Object.assign(r, patch);
                return Promise.resolve({ data: hit, error: null });
              },
            }),
          }),
        }),
      };
    },
  };
  return { db, requests, events };
}

const sheriff = (over: Partial<DecidePersistedInput> = {}): DecidePersistedInput => ({
  approvalId: "appr-1",
  decision: "approve",
  approverId: "user-owner-1",
  approverRole: "sheriff",
  passkeyStepUpVerified: true,
  nowIso: NOW,
  ...over,
});

describe("persisted approval decisions", () => {
  it("approves a T3 request only with a sheriff AND a verified passkey step-up, and records it once", async () => {
    const f = fakeDb(pending());
    const out = await decidePersistedApproval(f.db, sheriff());
    expect(out).toEqual({ ok: true, status: "approved" });
    expect(f.requests[0]).toMatchObject({
      status: "approved",
      decided_by: "user-owner-1",
      decided_role: "sheriff",
      decided_channel: "console",
      passkey_step_up_verified: true,
    });
    expect(f.events.map((e) => [e.kind, e.channel])).toContainEqual(["approve", "console"]);
  });

  it("refuses a T3 approval without the step-up, leaves the request pending and records the refusal", async () => {
    const f = fakeDb(pending());
    const out = await decidePersistedApproval(f.db, sheriff({ passkeyStepUpVerified: false }));
    expect(out).toEqual({ ok: false, code: "passkey_step_up_required" });
    expect(f.requests[0]?.status).toBe("pending");
    expect(
      f.events.some((e) => e.kind === "rejected" && e.code === "passkey_step_up_required"),
    ).toBe(true);
  });

  it("refuses a non-sheriff on T3, and refuses self-approval by the requester", async () => {
    const a = fakeDb(pending());
    expect(
      await decidePersistedApproval(a.db, sheriff({ approverRole: "platform_staff" })),
    ).toEqual({
      ok: false,
      code: "role_insufficient",
    });
    const b = fakeDb(pending());
    expect(
      await decidePersistedApproval(b.db, sheriff({ approverId: "agent:engineering-agent" })),
    ).toEqual({ ok: false, code: "self_approval_forbidden" });
    expect(a.requests[0]?.status).toBe("pending");
    expect(b.requests[0]?.status).toBe("pending");
  });

  it("lets the owner deny without a step-up", async () => {
    const f = fakeDb(pending());
    const out = await decidePersistedApproval(
      f.db,
      sheriff({ decision: "deny", passkeyStepUpVerified: false }),
    );
    expect(out).toEqual({ ok: true, status: "denied" });
    expect(f.requests[0]?.status).toBe("denied");
  });

  it("loses a race cleanly: a concurrent decision means already_decided and no second event", async () => {
    const f = fakeDb(pending(), { raceLost: true });
    const out = await decidePersistedApproval(f.db, sheriff());
    expect(out).toEqual({ ok: false, code: "already_decided" });
    expect(f.events).toHaveLength(0);
  });

  it("expires a request that is past its window instead of approving it", async () => {
    const f = fakeDb(pending());
    const out = await decidePersistedApproval(
      f.db,
      sheriff({ nowIso: "2026-11-16T12:00:00.000Z" }),
    );
    expect(out.ok).toBe(false);
    expect(f.requests[0]?.status).toBe("expired");
  });

  it("reports not_found and store failures without throwing", async () => {
    expect(await decidePersistedApproval(fakeDb(null).db, sheriff())).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(
      await decidePersistedApproval(fakeDb(pending(), { failRead: true }).db, sheriff()),
    ).toEqual({ ok: false, code: "store_unavailable" });
  });

  it("will not decide twice", async () => {
    const f = fakeDb(pending());
    await decidePersistedApproval(f.db, sheriff());
    const again = await decidePersistedApproval(f.db, sheriff({ decision: "deny" }));
    expect(again.ok).toBe(false);
    expect(f.requests[0]?.status).toBe("approved");
  });
});
