/**
 * M6 (mission E-016, ADR-117) — console onboarding queue, plan review, passkey step-up bound to
 * the plan hash, and the transactional provisioning wrapper. The database behaviour itself is
 * proved by tests/sql/m6-onboarding-provisioning.sql.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isValidStepUpBinding,
  newStepUpNonce,
  stepUpChallenge,
  stepUpChallengeMatches,
  type StepUpBinding,
} from "@/lib/jarvis-bridge/step-up";
import { diffPlans, onboardingApprovalId, queueAge, sortQueue } from "@/lib/onboarding/plan-review";
import {
  planProvisioningFailureCode,
  provisionApprovedPlan,
} from "@/lib/onboarding/provision-organization";
import { validateOnboardingPlan } from "@/lib/scholar/onboarding/plan-schema";
import { buildWebsiteDraft } from "@/lib/scholar/onboarding/website-draft";
import { validateDocument } from "@/lib/website/validate";
import {
  approveAndProvision,
  assignToSelf,
  beginPlanApproval,
  generateRequestPlan,
  loadQueue,
  loadRequestDetail,
  saveRequestPlanEdit,
  type AuditInput,
  type OnboardingConsoleDeps,
  type RequestRow,
  type SessionRow,
} from "@/lib/runtime/scholar/onboarding-console.server";
import { CONSOLE_NAV } from "@/lib/internal-console/roles";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "tests/fixtures/onboarding-plans");
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261117003100_sherivs_m6_onboarding_provisioning.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261117003100_sherivs_m6_onboarding_provisioning.sql"),
  "utf8",
);

const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = Date.parse("2026-11-17T12:00:00.000Z");

const goldenPlan = () =>
  JSON.parse(readFileSync(join(FIX, "private-secondary.plan.json"), "utf8")) as Record<
    string,
    unknown
  >;

/* ───────────────────────────── step-up binding ───────────────────────────── */

describe("step-up binding with a plan hash", () => {
  const base = (over: Partial<StepUpBinding> = {}): StepUpBinding => ({
    userId: STAFF,
    approvalId: onboardingApprovalId(REQ),
    decision: "approve",
    nonce: "AAAAAAAAAAAAAAAAAAAAAA",
    ...over,
  });

  it("leaves bindings without a digest exactly as before (JARVIS approvals unchanged)", async () => {
    const { createHash } = await import("node:crypto");
    const b = base();
    const legacy = createHash("sha256")
      .update(["sherivs.jarvis.step-up.v1", b.userId, b.approvalId, b.decision, b.nonce].join("|"))
      .digest("base64url");
    expect(stepUpChallenge(b)).toBe(legacy);
  });

  it("binds the plan hash: another hash, request, signer or decision gives another challenge", () => {
    const b = base({ subjectDigest: HASH_A });
    const c = stepUpChallenge(b);
    expect(c).not.toBe(stepUpChallenge(base()));
    for (const change of [
      { subjectDigest: HASH_B },
      { approvalId: onboardingApprovalId(REQ.replace(/c/g, "d")) },
      { userId: OTHER },
      { decision: "deny" as const },
      { nonce: newStepUpNonce() },
    ]) {
      expect(stepUpChallenge({ ...b, ...change })).not.toBe(c);
      expect(stepUpChallengeMatches(c, { ...b, ...change })).toBe(false);
    }
    expect(stepUpChallengeMatches(c, b)).toBe(true);
  });

  it("refuses a malformed digest", () => {
    expect(isValidStepUpBinding(base({ subjectDigest: "A".repeat(64) }))).toBe(false);
    expect(isValidStepUpBinding(base({ subjectDigest: "abc" }))).toBe(false);
    expect(() => stepUpChallenge(base({ subjectDigest: "x" }))).toThrow("invalid_step_up_binding");
  });

  it("approval ids are distinct from JARVIS ids and need a uuid", () => {
    expect(onboardingApprovalId(REQ)).toBe(`onboarding-request:${REQ}`);
    expect(() => onboardingApprovalId("appr-1")).toThrow();
  });
});

/* ───────────────────────────── plan review ───────────────────────────── */

describe("plan diff and queue ordering", () => {
  it("an unchanged plan has no diff, and reordering keyed units is not a change", () => {
    const p = goldenPlan();
    expect(diffPlans(p, structuredClone(p))).toEqual([]);
    const q = structuredClone(p) as { orgUnits: unknown[] };
    q.orgUnits = [...q.orgUnits].reverse();
    expect(diffPlans(p, q)).toEqual([]);
  });

  it("reports edits by path with identity-matched array items", () => {
    const p = goldenPlan() as { orgUnits: { key: string; name?: string }[]; rolePack: unknown };
    const q = structuredClone(p);
    q.orgUnits[1] = { ...q.orgUnits[1], name: "Junior Secondary" };
    q.rolePack = { code: "ng.private_secondary", version: "1.0.0" };
    const d = diffPlans(p, q);
    expect(d).toContainEqual({
      path: `orgUnits[key=${p.orgUnits[1].key}].name`,
      kind: "added",
      before: undefined,
      after: "Junior Secondary",
    });
    expect(d.find((e) => e.path === "rolePack.version")).toMatchObject({
      kind: "changed",
      before: "0.1.0",
      after: "1.0.0",
    });
  });

  it("reports added and removed set members", () => {
    const d = diffPlans({ curricula: ["a", "b"] }, { curricula: ["b", "c"] });
    expect(d).toEqual([
      { path: "curricula", kind: "removed", before: "a", after: undefined },
      { path: "curricula", kind: "added", before: undefined, after: "c" },
    ]);
  });

  it("sorts work needing review first, oldest first, and labels age from an injected clock", () => {
    const rows = sortQueue([
      { id: "1", status: "new" as const, createdAt: "2026-11-10T00:00:00Z" },
      { id: "2", status: "under_review" as const, createdAt: "2026-11-16T00:00:00Z" },
      { id: "3", status: "under_review" as const, createdAt: "2026-11-15T00:00:00Z" },
      { id: "4", status: "provisioned" as const, createdAt: "2026-11-01T00:00:00Z" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["3", "2", "1", "4"]);
    expect(queueAge("2026-11-17T11:30:00Z", NOW)).toBe("30m");
    expect(queueAge("2026-11-16T12:00:00Z", NOW)).toBe("24h");
    expect(queueAge("2026-11-10T12:00:00Z", NOW)).toBe("7d");
  });
});

/* ───────────────────────────── plan schema ───────────────────────────── */

describe("plan schema (M5a plan contract)", () => {
  it("accepts every M5a golden plan", () => {
    const files = readdirSync(FIX).filter((f) => f.endsWith(".plan.json"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const r = validateOnboardingPlan(JSON.parse(readFileSync(join(FIX, f), "utf8")));
      expect(r.ok ? [] : r.issues, f).toEqual([]);
    }
  });

  it("refuses unknown keys, verified links, enabled gated modules and broken unit trees", () => {
    const extra = { ...goldenPlan(), tenantId: "x" };
    expect(validateOnboardingPlan(extra).ok).toBe(false);

    const verified = goldenPlan() as { authorityLinkCandidates: { status: string }[] };
    verified.authorityLinkCandidates = [
      {
        ...(verified.authorityLinkCandidates[0] ?? {}),
        authority: "x",
        relation: "regulated_by",
        scope: null,
        status: "verified",
      } as never,
    ];
    expect(validateOnboardingPlan(verified).ok).toBe(false);

    const gated = goldenPlan() as { modules: unknown[] };
    gated.modules = [
      {
        code: "oversight_workspace",
        enabled: true,
        gate: { kind: "mandate_verification", mandate_status: "unverified" },
      },
    ];
    expect(validateOnboardingPlan(gated).ok).toBe(false);

    const orphan = goldenPlan() as { orgUnits: unknown[] };
    orphan.orgUnits = [{ key: "child", kind: "section", parentKey: "nowhere" }];
    const r = validateOnboardingPlan(orphan);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(" ")).toMatch(/parent must be listed/);
  });
});

/* ───────────────────────────── provisioning wrapper ───────────────────────────── */

describe("provisionApprovedPlan (atomic database path)", () => {
  it("sends only ids, the reviewed hash and a server-built draft, on the console channel", async () => {
    const rpc = vi.fn(async () => ({
      data: { organization_id: "org-1", replay: false },
      error: null,
    }));
    const out = await provisionApprovedPlan(rpc, {
      requestId: REQ,
      actorId: STAFF,
      expectedPlanHash: HASH_A,
      websiteDraft: null,
    });
    expect(out).toMatchObject({ ok: true, organizationId: "org-1", replay: false });
    expect(rpc).toHaveBeenCalledWith("onboarding_provision_from_plan", {
      p_request: REQ,
      p_actor: STAFF,
      p_expected_plan_hash: HASH_A,
      p_website_draft: null,
      p_channel: "console",
    });
  });

  it("maps database errors to stable codes and never reports a failure as provisioned", async () => {
    expect(planProvisioningFailureCode({ code: "PT409" })).toBe("stale_plan");
    expect(planProvisioningFailureCode({ code: "42501" })).toBe("not_allowed");
    expect(planProvisioningFailureCode({ code: "55000" })).toBe("incomplete_organization");
    expect(planProvisioningFailureCode({ code: "XX001" })).toBe("unavailable");
    const failing = async () => ({ data: null, error: { code: "PT409" } });
    expect(
      await provisionApprovedPlan(failing, {
        requestId: REQ,
        actorId: STAFF,
        expectedPlanHash: HASH_A,
        websiteDraft: null,
      }),
    ).toEqual({ ok: false, code: "stale_plan" });
    const empty = async () => ({ data: {}, error: null });
    expect(
      await provisionApprovedPlan(empty, {
        requestId: REQ,
        actorId: STAFF,
        expectedPlanHash: HASH_A,
        websiteDraft: null,
      }),
    ).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("website draft", () => {
  it("is generated from the request's own facts and passes the engine validator, or is pending", () => {
    const r = validateOnboardingPlan(goldenPlan());
    if (!r.ok) throw new Error("golden plan invalid");
    const doc = buildWebsiteDraft(
      {
        orgName: "Bright Future College",
        slugHint: "draft",
        contactEmail: "ada@bright.test",
        contactPhone: null,
        state: "lagos",
      },
      r.plan,
    );
    if (doc) expect(validateDocument(doc)).toEqual([]);
    else expect(doc).toBeNull();
  });
});

/* ───────────────────────────── server functions ───────────────────────────── */

function request(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: REQ,
    org_name: "Bright Future College",
    institution_type: "private_secondary",
    state: "lagos",
    lga: null,
    contact_name: "Ada Obi",
    contact_email: "ada@bright.test",
    contact_phone: null,
    contact_role: null,
    note: null,
    source: "public_onboarding",
    status: "plan_ready",
    assigned_staff: null,
    created_at: "2026-11-15T12:00:00Z",
    updated_at: "2026-11-15T12:00:00Z",
    generated_plan: goldenPlan(),
    review_plan: { ...goldenPlan(), rolePack: { code: "ng.private_secondary", version: "1.0.0" } },
    plan_hash: HASH_A,
    plan_revision: 1,
    plan_graph_version: "1.0.0",
    plan_edited_by: null,
    approved_plan_hash: null,
    approved_by: null,
    approved_at: null,
    provisioned_org_id: null,
    provisioned_at: null,
    ...over,
  };
}

function harness(
  opts: {
    caps?: string[];
    row?: RequestRow | null;
    session?: SessionRow | null;
    rpc?: (
      fn: string,
      args: Record<string, unknown>,
    ) => { data: unknown; error: { code?: string } | null };
    verifyFails?: boolean;
  } = {},
) {
  const audits: AuditInput[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const caps = new Set(
    opts.caps ?? [
      "platform.onboarding.read",
      "platform.onboarding.handle",
      "platform.tenants.manage",
    ],
  );
  const challenges: string[] = [];
  const deps: OnboardingConsoleDeps = {
    hasCapability: async (c) => caps.has(c),
    assertAal2: () => undefined,
    nowMs: () => NOW,
    newNonce: () => "BBBBBBBBBBBBBBBBBBBBBB",
    audit: async (e) => {
      audits.push(e);
    },
    stepUp: {
      assertionOptions: async ({ challenge }) => {
        challenges.push(challenge);
        return { challenge };
      },
      verifyAssertion: async ({ challengeAccepted, response }) => {
        if (opts.verifyFails) throw new Error("bad assertion");
        if (!challengeAccepted((response as { signed: string }).signed))
          throw new Error("challenge mismatch");
      },
    },
    store: {
      listRequests: async () => [
        request(),
        request({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "new",
          assigned_staff: STAFF,
        }),
      ],
      getRequest: async () => (opts.row === undefined ? request() : opts.row),
      latestSession: async () =>
        opts.session === undefined
          ? {
              graph_version: "pending-graph",
              answers: { "entry.organization.type": "private_secondary" },
              completion_pct: 100,
              completed_at: "2026-11-15T13:00:00Z",
            }
          : opts.session,
      staffNames: async (ids) => Object.fromEntries(ids.map((i) => [i, `Staff ${i.slice(0, 4)}`])),
      publishedPacks: async () => [{ code: "ng.private_secondary", version: "1.0.0" }],
      appliedResult: async () => null,
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (opts.rpc) return opts.rpc(fn, args);
        if (fn === "onboarding_review_set_plan")
          return {
            data: [{ plan_hash: HASH_B, plan_revision: 2, status: "under_review" }],
            error: null,
          };
        if (fn === "onboarding_provision_from_plan")
          return { data: { organization_id: "org-1", replay: false }, error: null };
        return { data: null, error: null };
      },
    },
  };
  return { deps, audits, rpcCalls, challenges };
}

const ctx = { userId: STAFF };

describe("queue and detail", () => {
  it("needs a console capability", async () => {
    const { deps } = harness({ caps: [] });
    await expect(loadQueue(ctx, deps)).rejects.toThrow("not_authorized");
    await expect(loadRequestDetail(ctx, deps, REQ)).rejects.toThrow("not_authorized");
  });

  it("lists requests with status, type, age and assignment", async () => {
    const { deps } = harness();
    const q = await loadQueue(ctx, deps);
    expect(q.rows[0]).toMatchObject({
      status: "plan_ready",
      institutionType: "private_secondary",
      age: "2d",
      assignedStaffName: null,
    });
    expect(q.rows[1]).toMatchObject({ status: "new", assignedToMe: true });
    expect(q.can).toEqual({ handle: true, manage: true });
  });

  it("detail shows answers read-only, the diff, and audits the view", async () => {
    const { deps, audits } = harness();
    const d = await loadRequestDetail(ctx, deps, REQ);
    expect(d.interview?.answers[0]).toMatchObject({
      questionId: "entry.organization.type",
      value: "private_secondary",
    });
    expect(d.plan.diff.map((e) => e.path)).toContain("rolePack.version");
    expect(d.plan.issues).toEqual([]);
    expect(d.can.approve).toBe(true);
    expect(audits).toContainEqual(
      expect.objectContaining({ action: "onboarding.request.view", outcome: "succeeded" }),
    );
  });

  it("flags an unpublished pack and blocks approval in the view", async () => {
    const { deps } = harness({ row: request({ review_plan: goldenPlan() }) });
    const d = await loadRequestDetail(ctx, deps, REQ);
    expect(d.plan.issues.join(" ")).toMatch(/not a published institution pack/);
    expect(d.can.approve).toBe(false);
  });

  it("the editor of the plan is not offered approval", async () => {
    const { deps } = harness({ row: request({ plan_edited_by: STAFF }) });
    expect((await loadRequestDetail(ctx, deps, REQ)).can.approve).toBe(false);
  });
});

describe("staff actions", () => {
  it("assign to self passes the verified actor, never a client value", async () => {
    const { deps, rpcCalls, audits } = harness();
    await assignToSelf(ctx, deps, REQ);
    expect(rpcCalls).toEqual([
      { fn: "onboarding_review_assign", args: { p_request: REQ, p_actor: STAFF } },
    ]);
    expect(audits.at(-1)).toMatchObject({
      action: "onboarding.request.assign",
      outcome: "succeeded",
    });
  });

  it("a database refusal is audited as denied and surfaces a code", async () => {
    const { deps, audits } = harness({ rpc: () => ({ data: null, error: { code: "42501" } }) });
    await expect(assignToSelf(ctx, deps, REQ)).rejects.toThrow("not_authorized");
    expect(audits.at(-1)).toMatchObject({ outcome: "denied" });
  });

  it("generating needs a completed interview and stores a schema-valid plan", async () => {
    const incomplete = harness({
      session: { graph_version: "g", answers: {}, completion_pct: 40, completed_at: null },
    });
    await expect(
      generateRequestPlan(ctx, incomplete.deps, { requestId: REQ, expectedRevision: 0 }),
    ).rejects.toThrow("interview_incomplete");
    expect(incomplete.rpcCalls).toEqual([]);

    const { deps, rpcCalls } = harness();
    const out = await generateRequestPlan(ctx, deps, { requestId: REQ, expectedRevision: 0 });
    expect(out).toEqual({ planHash: HASH_B, revision: 2, status: "under_review" });
    const args = rpcCalls[0].args;
    expect(args).toMatchObject({ p_kind: "generated", p_actor: STAFF, p_expected_revision: 0 });
    expect(validateOnboardingPlan(args.p_plan).ok).toBe(true);
  });

  it("an invalid edit is refused before the database and audited", async () => {
    const { deps, rpcCalls, audits } = harness();
    const out = await saveRequestPlanEdit(ctx, deps, {
      requestId: REQ,
      expectedRevision: 1,
      plan: { rolePack: 1 },
    });
    expect("invalid" in out && out.invalid.length > 0).toBe(true);
    expect(rpcCalls).toEqual([]);
    expect(audits.at(-1)).toMatchObject({ action: "onboarding.plan.edit", outcome: "failed" });
  });

  it("a valid edit is stored as 'edited' with the expected revision", async () => {
    const { deps, rpcCalls } = harness();
    const plan = { ...goldenPlan(), rolePack: { code: "ng.private_secondary", version: "1.0.0" } };
    await saveRequestPlanEdit(ctx, deps, { requestId: REQ, expectedRevision: 1, plan });
    expect(rpcCalls[0]).toMatchObject({
      fn: "onboarding_review_set_plan",
      args: { p_kind: "edited", p_expected_revision: 1 },
    });
  });
});

describe("approval with passkey bound to request and plan hash", () => {
  it("begin refuses a stale or different hash, and the plan's editor", async () => {
    await expect(
      beginPlanApproval(ctx, harness().deps, { requestId: REQ, planHash: HASH_B }),
    ).rejects.toThrow("stale");
    await expect(
      beginPlanApproval(ctx, harness().deps, { requestId: REQ, planHash: "nothex" }),
    ).rejects.toThrow("stale");
    await expect(
      beginPlanApproval(ctx, harness({ row: request({ plan_edited_by: STAFF }) }).deps, {
        requestId: REQ,
        planHash: HASH_A,
      }),
    ).rejects.toThrow("editor_cannot_approve");
    await expect(
      beginPlanApproval(ctx, harness({ caps: ["platform.onboarding.handle"] }).deps, {
        requestId: REQ,
        planHash: HASH_A,
      }),
    ).rejects.toThrow("not_authorized");
  });

  it("begin issues a challenge bound to signer, request, approve and the plan hash", async () => {
    const { deps, challenges } = harness();
    const out = await beginPlanApproval(ctx, deps, { requestId: REQ, planHash: HASH_A });
    expect(out.nonce).toBe("BBBBBBBBBBBBBBBBBBBBBB");
    expect(challenges[0]).toBe(
      stepUpChallenge({
        userId: STAFF,
        approvalId: onboardingApprovalId(REQ),
        decision: "approve",
        nonce: out.nonce,
        subjectDigest: HASH_A,
      }),
    );
  });

  it("an assertion signed for another plan hash is refused before any database write", async () => {
    const { deps, rpcCalls, audits } = harness();
    const signedForB = stepUpChallenge({
      userId: STAFF,
      approvalId: onboardingApprovalId(REQ),
      decision: "approve",
      nonce: "BBBBBBBBBBBBBBBBBBBBBB",
      subjectDigest: HASH_B,
    });
    await expect(
      approveAndProvision(ctx, deps, {
        requestId: REQ,
        planHash: HASH_A,
        nonce: "BBBBBBBBBBBBBBBBBBBBBB",
        response: { signed: signedForB },
      }),
    ).rejects.toThrow("step_up_failed");
    expect(rpcCalls).toEqual([]);
    expect(audits.at(-1)).toMatchObject({
      action: "onboarding.approval.step_up",
      outcome: "failed",
    });
  });

  it("a matching assertion approves with the hash, then provisions once in the database", async () => {
    const { deps, rpcCalls, audits } = harness({
      row: request({ status: "approved", approved_plan_hash: HASH_A, approved_by: STAFF }),
    });
    const nonce = "BBBBBBBBBBBBBBBBBBBBBB";
    const signed = stepUpChallenge({
      userId: STAFF,
      approvalId: onboardingApprovalId(REQ),
      decision: "approve",
      nonce,
      subjectDigest: HASH_A,
    });
    const out = await approveAndProvision(ctx, deps, {
      requestId: REQ,
      planHash: HASH_A,
      nonce,
      response: { signed },
    });
    expect(out).toMatchObject({ ok: true, organizationId: "org-1" });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "onboarding_review_approve",
      "onboarding_provision_from_plan",
    ]);
    expect(rpcCalls[0].args).toEqual({
      p_request: REQ,
      p_actor: STAFF,
      p_expected_plan_hash: HASH_A,
      p_step_up_verified: true,
    });
    expect(rpcCalls[1].args).toMatchObject({
      p_request: REQ,
      p_actor: STAFF,
      p_expected_plan_hash: HASH_A,
      p_channel: "console",
    });
    expect(Object.keys(rpcCalls[1].args).sort()).toEqual([
      "p_actor",
      "p_channel",
      "p_expected_plan_hash",
      "p_request",
      "p_website_draft",
    ]);
    expect(audits.map((a) => `${a.action}:${a.outcome}`)).toEqual([
      "onboarding.approval.step_up:succeeded",
      "onboarding.plan.approve:succeeded",
      "onboarding.provision:succeeded",
    ]);
  });

  it("a stale hash at approval stops before provisioning", async () => {
    const nonce = "BBBBBBBBBBBBBBBBBBBBBB";
    const signed = stepUpChallenge({
      userId: STAFF,
      approvalId: onboardingApprovalId(REQ),
      decision: "approve",
      nonce,
      subjectDigest: HASH_A,
    });
    const { deps, rpcCalls } = harness({
      rpc: (fn) => ({
        data: null,
        error: fn === "onboarding_review_approve" ? { code: "PT409" } : null,
      }),
    });
    await expect(
      approveAndProvision(ctx, deps, {
        requestId: REQ,
        planHash: HASH_A,
        nonce,
        response: { signed },
      }),
    ).rejects.toThrow("stale");
    expect(rpcCalls.map((c) => c.fn)).toEqual(["onboarding_review_approve"]);
  });
});

/* ───────────────────────────── migration and wiring ───────────────────────────── */

describe("migration contract and console wiring", () => {
  it("is marked NOT APPLIED and seeds the self-serve flag OFF and locked", () => {
    expect(MIGRATION.split("\n")[0]).toBe(
      "-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.",
    );
    expect(MIGRATION).toMatch(/'self_serve_provisioning', false, true/);
    expect(MIGRATION).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
  });

  it("grants every new function to service_role only", () => {
    const fns = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z0-9_]+)\(/g)].map(
      (m) => m[1],
    );
    expect(fns.length).toBeGreaterThanOrEqual(10);
    for (const f of new Set(fns)) {
      expect(MIGRATION).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION ${f.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`,
        ),
      );
      expect(MIGRATION).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION ${f.replace(".", "\\.")}\\([^)]*\\) TO [^;]*authenticated`,
        ),
      );
    }
    expect(MIGRATION).toMatch(/organization_root_gaps\(\) g WHERE g\.org_id = v_org/);
  });

  it("the rollback drops what the migration adds", () => {
    for (const name of [
      "onboarding_provision_from_plan",
      "onboarding_review_approve",
      "organization_invitations",
      "onboarding_request_id",
      "self_serve_provisioning",
    ])
      expect(ROLLBACK).toContain(name);
  });

  it("the console nav and paths include the onboarding queue", () => {
    const org = CONSOLE_NAV.find((i) => i.key === "organizations");
    expect(org?.children?.find((c) => c.key === "onboarding-requests")).toMatchObject({
      href: CONSOLE_PATHS.onboarding,
      anyOf: ["platform.onboarding.read", "platform.tenants.manage"],
    });
    expect(CONSOLE_PATHS.onboardingRequest(REQ)).toBe(`/console/onboarding/${REQ}`);
  });
});
