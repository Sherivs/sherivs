/**
 * JARVIS executive severity and routing (ENGINE-04, ADR-082).
 *
 * Severity says how urgently a human must hear about something. Tier (from the
 * broker) says what authority an action needs. They are independent: a T1 action
 * can be S1 if it happens during a security incident, and a T3 request can be S3.
 * Routing combines the broker's verdict with severity; it never raises authority.
 *
 * Pure module: no I/O, no clock. Time is passed in.
 */
import type { Decision } from "../tool-broker/broker";
import type { RolePackTier } from "../twin-engine/role-pack";
import { tierRank } from "../twin-engine/role-pack";

export const SEVERITIES = ["S1", "S2", "S3", "S4"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface SeverityFacts {
  readonly tier: RolePackTier;
  readonly scope: "single_user" | "tenant" | "platform";
  readonly reversible: boolean;
  readonly securityIncident: boolean;
  readonly customerVisible: boolean;
}

export function classifySeverity(f: SeverityFacts): Severity {
  if (f.securityIncident || (f.scope === "platform" && !f.reversible)) return "S1";
  if (
    f.scope === "platform" ||
    tierRank(f.tier) >= tierRank("T3") ||
    (f.scope === "tenant" && !f.reversible)
  ) {
    return "S2";
  }
  if (tierRank(f.tier) >= tierRank("T2") || f.scope === "tenant" || f.customerVisible) return "S3";
  return "S4";
}

export const ROUTES = [
  "act",
  "log_only",
  "inbox_proposal",
  "approval_inbox",
  "sheriff_console",
  "refuse",
] as const;
export type Route = (typeof ROUTES)[number];

export interface ExecutiveBudget {
  readonly actionsToday: number;
  readonly dailyActionLimit: number;
}

export interface RoutingResult {
  readonly route: Route;
  readonly alertOwner: boolean;
  readonly reasons: readonly string[];
}

/**
 * Executive routing. JARVIS may itself ACT only on an execute verdict at T1 or
 * below and inside its daily budget; everything else goes to a human surface.
 * A deny is always refused, and an S1/S2 deny (kill switch, forbidden tier,
 * scope violation) also alerts the owner so an attempted breach is never silent.
 */
export function routeDecision(
  decision: Decision,
  severity: Severity,
  budget: ExecutiveBudget,
): RoutingResult {
  const alertFloor = severity === "S1" || severity === "S2";
  switch (decision.verdict) {
    case "deny":
      return {
        route: "refuse",
        alertOwner: alertFloor,
        reasons: [`denied: ${decision.denyCode ?? "unspecified"}`],
      };
    case "sheriff_passkey":
      return {
        route: "sheriff_console",
        alertOwner: true,
        reasons: ["T3 needs the sheriff passkey in the console"],
      };
    case "queue_approval":
      return {
        route: "approval_inbox",
        alertOwner: alertFloor,
        reasons: [`approval by ${decision.approver ?? "role_owner"}`],
      };
    case "propose":
      return { route: "inbox_proposal", alertOwner: false, reasons: ["proposal only"] };
    case "shadow":
      return { route: "log_only", alertOwner: false, reasons: ["shadow: logged only"] };
    case "execute": {
      if (tierRank(decision.tier) > tierRank("T1")) {
        return {
          route: "approval_inbox",
          alertOwner: alertFloor,
          reasons: ["executive autonomy stops at T1; a T2 execute needs a human"],
        };
      }
      if (budget.actionsToday >= budget.dailyActionLimit) {
        return {
          route: "approval_inbox",
          alertOwner: true,
          reasons: ["executive daily action budget exhausted"],
        };
      }
      return { route: "act", alertOwner: false, reasons: ["within executive authority"] };
    }
  }
}
