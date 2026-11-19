import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const VERSION = "20261117000900";
const NAME = "sherivs_wf07_approval_inbox.sql";
const up = readFileSync(join(ROOT, "database/supabase/migrations", `${VERSION}_${NAME}`), "utf8");
const down = readFileSync(join(ROOT, "database/supabase/rollbacks", `${VERSION}_${NAME}`), "utf8");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end);
}

describe("WF-07 migration (static)", () => {
  it("is marked NOT APPLIED and stacked after WF-06", () => {
    expect(up.startsWith("-- NOT APPLIED")).toBe(true);
    expect(down.startsWith("-- NOT APPLIED")).toBe(true);
    expect(Number(VERSION)).toBeGreaterThan(20261117000800);
  });

  it("forces RLS on all three new tables and gives anon nothing", () => {
    for (const table of ["wf_approval_policy", "wf_approval_step_up", "wf_approval_decision"]) {
      expect(up).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(up).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(up).not.toMatch(/GRANT[^;]*\bTO\s+(anon|PUBLIC)\b/);
    expect(up).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE)[^;]*TO/);
  });

  it("step-up and decision rows are written only by the definer functions", () => {
    expect(up).toMatch(/GRANT SELECT ON TABLE public\.wf_approval_step_up TO service_role;/);
    expect(up).not.toMatch(/GRANT[^;]*INSERT[^;]*wf_approval_(step_up|decision)/);
    expect(up).not.toMatch(
      /GRANT[^;]*wf_approval_(step_up|decision)[^;]*TO authenticated[^;]*INSERT/,
    );
  });

  it("every callable WF-07 function is SECURITY DEFINER with an empty search_path and service-role-only execute", () => {
    const callable = [
      "wf_request_draft_approval",
      "wf_request_missing_draft_approvals",
      "wf_inbox_list",
      "wf_approval_view",
      "wf_audit_step_up_failed",
      "wf_record_step_up",
      "wf_decide_approval",
      "wf_expire_approvals",
      "wf_approved_drafts_ready",
      "wf_resume_after_dispatch",
      "wf_approver_candidates",
    ];
    for (const fn of callable) {
      const header = up.slice(
        up.indexOf(`CREATE FUNCTION public.${fn}(`),
        up.indexOf("AS $$", up.indexOf(`CREATE FUNCTION public.${fn}(`)),
      );
      expect(header, fn).toContain("SECURITY DEFINER");
      expect(header, fn).toContain("SET search_path = ''");
    }
    const grant = up.slice(
      up.lastIndexOf("GRANT EXECUTE ON FUNCTION"),
      up.indexOf("TO service_role;", up.lastIndexOf("GRANT EXECUTE ON FUNCTION")),
    );
    for (const fn of callable) expect(grant).toContain(`public.${fn}(`);
    expect(up).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\b(authenticated|anon|PUBLIC)\b/);
  });

  it("the decision function binds the actor and never trusts a role from the caller", () => {
    const body = functionBody(up, "CREATE FUNCTION public.wf_decide_approval(");
    expect(body).toContain("public.wf_act_as(p_actor)");
    expect(body).toContain("public.wf_decision_blockers(");
    expect(body).toContain("wf_approval_content_digest");
    expect(body).toContain("decision_channel = 'console'");
    expect(body).toContain("workflow.approval.vote_");
    expect(body).not.toMatch(/p_role|p_permission|p_is_admin/);
  });

  it("the blocker list enforces permission, requester, author and one vote each", () => {
    const body = functionBody(up, "CREATE FUNCTION public.wf_decision_blockers(");
    for (const code of [
      "not_authorized",
      "requester",
      "author",
      "already_voted",
      "expired",
      "not_pending",
    ]) {
      expect(body).toContain(`'${code}'`);
    }
    expect(body).toContain("has_permission(v_a.org_id, v_a.required_permission)");
  });

  it("replaces the WF-06 cap check: approving needs an approval link and never an unregistered webhook", () => {
    expect(up).toContain("DROP CONSTRAINT wf_action_draft_cap_check");
    expect(up.replace(/\s+/g, " ")).toContain(
      "status <> 'approved' OR (approval_id IS NOT NULL AND category <> 'unregistered_webhook')",
    );
    expect(up).toContain("FOREIGN KEY (org_id, approval_id)");
  });

  it("N1: the draft is frozen except status, approval link and update time, by an INVOKER trigger", () => {
    const header = up.slice(
      up.indexOf("CREATE FUNCTION public.wf_action_draft_freeze()"),
      up.indexOf("AS $$", up.indexOf("CREATE FUNCTION public.wf_action_draft_freeze()")),
    );
    expect(header).toContain("SECURITY INVOKER");
    expect(header).toContain("SET search_path = ''");
    const body = functionBody(up, "CREATE FUNCTION public.wf_action_draft_freeze()");
    for (const column of [
      "kind",
      "category",
      "recipient_ids",
      "audience_selector",
      "data_class",
      "template_ref",
      "template_params",
      "webhook_target_id",
      "run_id",
      "step_run_id",
      "idempotency_key",
    ]) {
      expect(body, column).toContain(`NEW.${column}`);
    }
    expect(up).toContain("CREATE TRIGGER wf_action_draft_10_freeze");
  });

  it("N2 and N8: a webhook outbox row names its target, and the outbox guard is not callable", () => {
    expect(up).toMatch(/CHECK \(kind <> 'webhook' OR webhook_target_id IS NOT NULL\)/);
    expect(up).toMatch(
      /REVOKE ALL ON FUNCTION public\.wf_action_sandbox_outbox_guard\(\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it("the passkey evidence is single use, short lived and bound to the digest", () => {
    expect(up).toContain("interval '5 minutes'");
    expect(up).toMatch(/content_digest = v_digest AND used_at IS NULL AND revoked_at IS NULL/);
    expect(up).toContain("used_at = now()");
  });

  it("the policy defaults are one approver, and two for money, safeguarding and mass messages", () => {
    const body = functionBody(up, "CREATE FUNCTION public.wf_approval_required_count(");
    expect(body).toMatch(/money_movement.*safeguarding.*mass_message/s);
    expect(up).toMatch(
      /two_person_categories[^;]*'money_movement', 'safeguarding', 'mass_message'/,
    );
  });

  it("has a rollback that refuses to strand approved capped records and drops what it added", () => {
    expect(down).toContain("approved capped drafts exist");
    for (const dropped of [
      "wf_approval_decision",
      "wf_approval_step_up",
      "wf_approval_policy",
      "wf_decide_approval",
    ]) {
      expect(down).toContain(dropped);
    }
    expect(down).toContain("wf_action_draft_cap_check");
  });

  it("contains no real credentials, addresses or live-send hooks", () => {
    expect(up).not.toMatch(/https?:\/\//);
    expect(up).not.toMatch(/api[_-]?key|password|bearer|service_role_key/i);
  });
});

describe("WF-07 inbox in the workspace shell (static)", () => {
  const section = read("frontend/src/components/app-shell/section-screen.tsx");
  const shell = read("frontend/src/components/app-shell/app-shell.tsx");
  const screen = read("frontend/src/components/app-shell/approval-inbox-screen.tsx");
  const css = read("frontend/src/components/app-shell/approval-inbox.css");

  it("is lazy-loaded and never imported statically, so /home does not grow", () => {
    expect(section).toMatch(/lazy\(\(\) => import\("\.\/approval-inbox-screen"\)\)/);
    expect(section).not.toMatch(/^import[^\n]*approval-inbox-screen/m);
    expect(shell).not.toMatch(/approval-inbox-screen/);
    expect(section).toContain('sectionKey === "approvals"');
  });

  it("has a drawer entry that opens /home/s/approvals", () => {
    expect(shell).toContain("APP_SHELL_APPROVALS");
    expect(read("frontend/src/lib/shell/paths.ts")).toContain(
      'APP_SHELL_APPROVALS = "/home/s/approvals"',
    );
  });

  it("keeps the account navigation the shell tests pin unchanged", () => {
    const paths = read("frontend/src/lib/shell/paths.ts");
    const account = paths.slice(paths.indexOf("APP_SHELL_ACCOUNT_PATHS"));
    expect(account).not.toContain("APPROVALS");
  });

  it("asks only the server functions, with the verified session, and holds no time source", () => {
    expect(screen).toContain("@/lib/workflow-approvals.functions");
    expect(screen).not.toMatch(/supabase|from\("wf_/);
    expect(screen).not.toMatch(/\bDate\.now\s*\(|new Date\(\s*\)/);
    expect(screen).toContain("startAuthentication");
    expect(screen).toContain("digest: detail.digest");
  });

  it("makes every control at least 44px and shows the waiting and step-up states", () => {
    expect(css).toMatch(/\.wf-inbox-button,[\s\S]*?min-height: 44px/);
    expect(css).toMatch(
      /\.wf-inbox-row \{[\s\S]*?min-width|\.wf-inbox-button,[\s\S]*?\.wf-inbox-row \{[\s\S]*?min-height: 44px/,
    );
    expect(css).toMatch(/\.wf-inbox-note textarea \{[\s\S]*?min-height: 44px/);
    expect(screen).toContain('data-testid="approval-waiting"');
    expect(screen).toContain('data-testid="approval-step-up-note"');
    expect(screen).toContain('data-testid="approval-passkey-prompt"');
    expect(screen).toContain('data-testid="approval-digest"');
  });

  it("the server functions never accept the approver or a risk level from the client", () => {
    const fns = read("frontend/src/lib/workflow-approvals.functions.ts");
    expect(fns).toContain("context.userId");
    expect(fns).not.toMatch(/data\.(actor|approver|risk|role)/);
    expect(fns.match(/requireSupabaseAuth/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
