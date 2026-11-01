import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONSOLE_SUBSCRIPTION_PREFIX,
  canTransitionIncident,
  canTransitionTicket,
  isConsoleSubscriptionReference,
  sanitizeLogQuery,
} from "@/lib/internal-console/operations";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { CONSOLE_NAV, filterNav, viewerCapabilities } from "@/lib/internal-console/roles";
import {
  WORKSPACE_EXPERIENCES,
  visibleWorkspaceNav,
} from "@/lib/internal-console/workspace-experience";
import { CONSOLE_METRIC_CONTRACTS } from "@/lib/internal-console/metrics";
import { settleConsoleSubscription } from "@/lib/payments/console-subscription-settlement";

const migration = readFileSync(
  "database/supabase/migrations/20261027003000_sherivs_032_control_plane_operations.sql",
  "utf8",
);

describe("control-plane operations domain", () => {
  it("rejects invalid ticket and incident transitions", () => {
    expect(canTransitionTicket("open", "resolved")).toBe(true);
    expect(canTransitionTicket("closed", "open")).toBe(false);
    expect(canTransitionIncident("open", "acknowledged")).toBe(true);
    expect(canTransitionIncident("closed", "mitigating")).toBe(false);
  });

  it("sanitizes log search wildcards", () => {
    expect(sanitizeLogQuery("  platform_%staff  ")).toBe("platform staff");
    expect(sanitizeLogQuery("a".repeat(100)).length).toBe(80);
  });

  it("recognizes console subscription references", () => {
    expect(isConsoleSubscriptionReference(`${CONSOLE_SUBSCRIPTION_PREFIX}abc`)).toBe(true);
    expect(isConsoleSubscriptionReference("uos_fee")).toBe(false);
  });
});

describe("SHERIVS-032 operations migration", () => {
  it("forces RLS and revokes client writes", () => {
    for (const table of ["platform_ticket", "platform_incident"]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
    expect(migration).toContain("platform.support.handle");
    expect(migration).toContain("Not learner, invoice, or biometric");
  });
});

describe("console operations navigation", () => {
  it("registers tickets, incidents, logs, and billing under /console", () => {
    expect(CONSOLE_PATHS.activityTickets).toBe("/console/activity/tickets");
    expect(CONSOLE_PATHS.activityIncidents).toBe("/console/activity/incidents");
    expect(CONSOLE_PATHS.activityBilling).toBe("/console/activity/billing");
    expect(CONSOLE_PATHS.activityLogs).toBe("/console/activity/logs");
  });

  it("shows support tickets while denying incidents and billing to support specialists", () => {
    const support = {
      isSuperAdmin: false,
      capabilities: viewerCapabilities(["support"], false),
    };
    const activity = filterNav(CONSOLE_NAV, support).find((item) => item.key === "activity");
    expect(activity?.children?.map((item) => item.key)).toEqual(["metrics", "tickets"]);
    const organizations = filterNav(CONSOLE_NAV, support).find(
      (item) => item.key === "organizations",
    );
    expect(organizations?.children?.map((item) => item.key)).not.toContain("billing");
  });

  it("shows engineering logs and incidents", () => {
    const engineer = {
      isSuperAdmin: false,
      capabilities: viewerCapabilities(["engineering"], false),
    };
    const activity = filterNav(CONSOLE_NAV, engineer).find((item) => item.key === "activity");
    expect(activity?.children?.map((item) => item.key)).toEqual(["metrics", "logs", "incidents"]);
    expect(
      visibleWorkspaceNav(WORKSPACE_EXPERIENCES.engineering, engineer).map((item) => item.label),
    ).toEqual(["Runtime health", "Sherivs Scholar", "Metrics", "Logs", "Incidents", "Help"]);
  });
});

describe("subscription ledger contract", () => {
  it("counts payment-history rows instead of inventing revenue", () => {
    const metric = CONSOLE_METRIC_CONTRACTS.find((row) => row.key === "subscription-ledger");
    expect(metric?.calculation).toMatch(/count/i);
    expect(metric?.source).toMatch(/public.subscriptions/i);
    expect(metric?.definition).toMatch(/not this metric/i);
  });
});

describe("console subscription settlement", () => {
  it("settles a pending matching charge once", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      school_id: "22222222-2222-4222-8222-222222222222",
      amount_paid: 50,
      status: "pending",
      paystack_reference: `${CONSOLE_SUBSCRIPTION_PREFIX}ref`,
    };
    let updated = 0;
    const db = {
      from() {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: row, error: null }) };
              },
            };
          },
          update() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      select: async () => {
                        updated += 1;
                        return { data: [{ id: row.id }], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const first = await settleConsoleSubscription(db as never, {
      reference: row.paystack_reference,
      status: "success",
      amountKobo: 5000,
      currency: "NGN",
    });
    expect(first).toEqual({
      outcome: "settled",
      subscriptionId: row.id,
      schoolId: row.school_id,
    });
    expect(updated).toBe(1);
  });

  it("rejects amount mismatch", async () => {
    const db = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: "1",
                      school_id: "2",
                      amount_paid: 50,
                      status: "pending",
                      paystack_reference: `${CONSOLE_SUBSCRIPTION_PREFIX}ref`,
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };
    const result = await settleConsoleSubscription(db as never, {
      reference: `${CONSOLE_SUBSCRIPTION_PREFIX}ref`,
      status: "success",
      amountKobo: 1,
      currency: "NGN",
    });
    expect(result.outcome).toBe("rejected");
  });
});
