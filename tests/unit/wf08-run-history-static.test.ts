import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const VERSION = "20261117000950";
const NAME = "sherivs_wf08_run_history.sql";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const up = read(`database/supabase/migrations/${VERSION}_${NAME}`);
const down = read(`database/supabase/rollbacks/${VERSION}_${NAME}`);

describe("WF-08 migration (static)", () => {
  it("is marked NOT APPLIED, sits after WF-07 and below the next reserved slot", () => {
    expect(up.startsWith("-- NOT APPLIED")).toBe(true);
    expect(down.startsWith("-- NOT APPLIED")).toBe(true);
    expect(Number(VERSION)).toBeGreaterThan(20261117000900);
    expect(Number(VERSION)).toBeLessThan(20261117001000);
  });

  it("adds no table and never loosens grants", () => {
    expect(up).not.toMatch(/CREATE TABLE/i);
    // The only grant to a client role is the column-level SELECT in section 8b, which narrows what WF-01/WF-06
    // allowed (it follows a table-level REVOKE). Nothing else may be granted to anon, PUBLIC or authenticated.
    const clientGrants = [...up.matchAll(/GRANT[^;]*\bTO\s+(?:anon|PUBLIC|authenticated)\b/g)].map(
      (m) => m[0],
    );
    expect(clientGrants.length).toBeGreaterThan(0);
    for (const g of clientGrants) expect(g).toMatch(/^GRANT SELECT \(/);
    expect(up).toMatch(
      /REVOKE SELECT ON public\.wf_event, public\.wf_step_run, public\.wf_run_event, public\.wf_action_draft FROM authenticated/,
    );
    expect(up).not.toMatch(
      /GRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*\bTO\s+(anon|PUBLIC|authenticated)\b/,
    );
    expect(up).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY/i);
    expect(up).not.toMatch(/DROP POLICY/i);
  });

  it("every callable function is SECURITY DEFINER with an empty search_path and service-role-only execute", () => {
    for (const fn of [
      "wf_run_cancel",
      "wf_run_retry",
      "wf_run_history_list",
      "wf_run_history_detail",
    ]) {
      const start = up.indexOf(`CREATE FUNCTION public.${fn}(`);
      expect(start, `${fn} defined`).toBeGreaterThan(-1);
      const header = up.slice(start, up.indexOf("AS $$", start));
      expect(header).toMatch(/SECURITY DEFINER/);
      expect(header).toMatch(/SET search_path = ''/);
      expect(up).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*public\\.${fn}\\(`));
    }
    expect(up).toMatch(/TO service_role;/);
  });

  it("binds the actor and gates on workflow permissions, never on input", () => {
    expect(up).toMatch(/wf_act_as\(p_actor\)/);
    expect(up).toMatch(/get_my_organization_id\(\)/);
    expect(up).toMatch(/wf_can\(v_org, 'workflows\.view'\)/);
    expect(up).toMatch(/wf_can\(v_org, 'workflows\.run'\)/);
    expect(up).toMatch(/wf_can\(v_org, 'workflows\.manage'\)/);
    expect(up).not.toMatch(/p_org\s+uuid,\s*p_actor/);
  });

  it("audits retry and cancel", () => {
    expect(up).toContain("workflow.run.retry_requested");
    expect(up).toContain("workflow.run.cancel_requested");
    expect(up).toMatch(/wf_audit_append/);
  });

  it("redacts by allow-list and returns no free-text or recipient columns", () => {
    expect(up).toContain("wf_redact_event_detail");
    for (const forbidden of [
      "recipient_ids,",
      "template_params,",
      "input_ref,",
      "subject_ref",
      "decision_note",
      "target_url",
    ]) {
      const detailFn = up.slice(up.indexOf("CREATE FUNCTION public.wf_run_history_detail("));
      expect(detailFn.includes(`'${forbidden.replace(",", "")}'`), forbidden).toBe(false);
    }
    expect(up).toMatch(/cardinality\(d\.recipient_ids\)/);
  });

  it("closes the dispatch race after a cancel and refuses live effects on retry", () => {
    expect(up).toContain("wf_action_sandbox_outbox_run_guard");
    expect(up).toContain("wf08:autonomy_escalation");
    for (const code of ["draft_exists", "effect_recorded", "retry_limit", "run_not_retryable"]) {
      expect(up).toContain(`'${code}'`);
    }
    expect(up).not.toMatch(/INSERT INTO public\.wf_action_(draft|sandbox_outbox)/);
    expect(up).not.toMatch(
      /UPDATE public\.wf_(step_run|run) SET status = '(succeeded|dead|failed)'/,
    );
  });

  it("the rollback refuses once retry runs exist and removes every object", () => {
    expect(down).toMatch(/retry_of_run_id IS NOT NULL/);
    for (const obj of [
      "wf_run_cancel",
      "wf_run_retry",
      "wf_run_history_list",
      "wf_run_history_detail",
      "wf_retry_blockers",
      "wf_redact_event_detail",
      "wf_run_control_reason_ok",
      "wf_run_retry_guard",
      "wf_action_sandbox_outbox_run_guard",
      "wf_run_one_retry_per_step",
      "retry_generation",
    ]) {
      expect(down, obj).toContain(obj);
    }
  });
});

describe("WF-08 surfaces (static)", () => {
  const fn = read("frontend/src/lib/workflow-run-history.functions.ts");
  const screen = read("frontend/src/components/app-shell/run-history-screen.tsx");
  const server = read("frontend/src/lib/workflow/run-history.server.ts");

  it("every server function requires a session and takes the person from it", () => {
    expect((fn.match(/createServerFn/g) ?? []).length).toBe(5);
    expect((fn.match(/requireSupabaseAuth/g) ?? []).length).toBe(5);
    expect(fn).toMatch(/actorId: context\.userId/);
    expect(fn).not.toMatch(/data\.(actorId|orgId|schoolId)/);
  });

  it("the operations import no database client and read no clock", () => {
    expect(server).not.toMatch(/supabase|Date\.now|new Date/);
    expect(screen).not.toMatch(/Date\.now/);
  });

  it("the screen never renders recipients, parameters or payloads", () => {
    expect(screen).not.toMatch(/recipient_ids|template_params|payload|input_ref|\.email|\.phone/);
  });

  it("the screen is lazy in the shell and linked from the drawer", () => {
    const section = read("frontend/src/components/app-shell/section-screen.tsx");
    expect(section).toMatch(/lazy\(\(\) => import\("\.\/run-history-screen"\)\)/);
    expect(read("frontend/src/components/app-shell/app-shell.tsx")).toContain("run-history-link");
    expect(read("frontend/src/lib/shell/paths.ts")).toContain("/home/s/workflow-runs");
  });

  it("is accessible: status is text, errors are announced, targets are real buttons", () => {
    expect(screen).toContain('role="alert"');
    expect(screen).toContain('aria-live="polite"');
    expect(screen).toContain("aria-describedby");
    expect(screen).toContain("STATUS_LABEL");
    expect(screen).not.toMatch(/<div[^>]*onClick/);
  });
});
