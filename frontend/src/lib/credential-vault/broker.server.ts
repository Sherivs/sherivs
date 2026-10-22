/**
 * Sherivs Vault — agent credential broker.
 *
 * Agents (AI agents, n8n workflows, the Jarvis twin) never hold standing keys.
 * They request a grant for ONE scope and purpose; the broker checks policy,
 * requires human approval for critical scopes, issues a single-use grant that
 * lives at most 5 minutes, and on redeem performs the call with the decrypted
 * credential so the agent never sees it. Every step is written to the
 * append-only access log (public.credential_access_log), which the organization can
 * read for its own organization.
 */
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CredentialVault } from "./vault.server";

export const MAX_GRANT_TTL_SECONDS = 300;

export interface Scope { orgId: string; provider: string; name: string; action: string }

export interface PolicyRule {
  agentId: string; // exact agent id or "*"
  provider: string;
  actions: string[];
  critical?: boolean; // requires human approval
  maxTtlSeconds?: number;
}

export type GrantStatus = "pending_approval" | "approved" | "denied" | "redeemed" | "expired";

export interface Grant {
  id: string; agentId: string; scope: Scope; purpose: string; status: GrantStatus;
  critical: boolean; ttlSeconds: number; createdAt: Date; expiresAt: Date | null;
  approvedBy: string | null; tokenHash: string | null;
}

export type AccessEvent = "requested" | "denied_policy" | "approval_requested" | "approved" | "denied"
  | "issued" | "redeemed" | "redeem_rejected" | "expired";

export interface AccessLogEntry {
  at: Date; event: AccessEvent; grantId: string | null; agentId: string; orgId: string;
  provider: string; action: string; purpose: string; actor: string | null; detail?: string;
}

export interface AccessLog { append(e: AccessLogEntry): Promise<void>; forOrg(orgId: string): Promise<AccessLogEntry[]> }

export class InMemoryAccessLog implements AccessLog {
  private entries: AccessLogEntry[] = [];
  async append(e: AccessLogEntry) { this.entries.push(Object.freeze({ ...e })); }
  async forOrg(orgId: string) { return this.entries.filter((e) => e.orgId === orgId); }
}

export interface Approver { notify(grant: Grant): Promise<void> }

const timeAuthority = new TimeAuthority(new SystemClock());
const systemNow = (): Date => new Date(timeAuthority.now().atMs);

const hash = (t: string) => createHash("sha256").update(t).digest();

export class CredentialBroker {
  private grants = new Map<string, Grant>();
  constructor(private readonly deps: {
    vault: CredentialVault; policy: PolicyRule[]; log: AccessLog; approver?: Approver; now?: () => Date;
  }) {}
  private now() { return this.deps.now ? this.deps.now() : systemNow(); }

  private entry(g: { agentId: string; scope: Scope; purpose: string }, event: AccessEvent, grantId: string | null, actor: string | null = null, detail?: string): AccessLogEntry {
    return { at: this.now(), event, grantId, agentId: g.agentId, orgId: g.scope.orgId, provider: g.scope.provider,
      action: g.scope.action, purpose: g.purpose, actor, detail };
  }

  private match(agentId: string, s: Scope): PolicyRule | undefined {
    return this.deps.policy.find((r) => (r.agentId === agentId || r.agentId === "*")
      && r.provider === s.provider && r.actions.includes(s.action));
  }

  async request(input: { agentId: string; scope: Scope; purpose: string; ttlSeconds?: number }):
    Promise<{ grantId: string; status: GrantStatus; token?: string; expiresAt?: Date }> {
    const { agentId, scope, purpose } = input;
    const ttl = Math.min(input.ttlSeconds ?? MAX_GRANT_TTL_SECONDS, MAX_GRANT_TTL_SECONDS);
    await this.deps.log.append(this.entry(input, "requested", null));
    const rule = this.match(agentId, scope);
    const purposeOk = typeof purpose === "string" && purpose.trim().length >= 10 && purpose.length <= 500;
    if (!rule || !purposeOk || ttl <= 0 || !(await this.deps.vault.exists(scope.orgId, scope.provider, scope.name))) {
      await this.deps.log.append(this.entry(input, "denied_policy", null, null,
        !rule ? "no matching policy" : !purposeOk ? "purpose must be 10-500 chars" : ttl <= 0 ? "invalid ttl" : "credential not configured"));
      throw new Error("broker: request denied by policy");
    }
    const g: Grant = { id: crypto.randomUUID(), agentId, scope: { ...scope }, purpose, critical: !!rule.critical,
      ttlSeconds: Math.min(ttl, rule.maxTtlSeconds ?? MAX_GRANT_TTL_SECONDS), createdAt: this.now(),
      status: rule.critical ? "pending_approval" : "approved", expiresAt: null, approvedBy: null, tokenHash: null };
    this.grants.set(g.id, g);
    if (g.critical) {
      await this.deps.log.append(this.entry(g, "approval_requested", g.id));
      await this.deps.approver?.notify({ ...g });
      return { grantId: g.id, status: g.status };
    }
    return { grantId: g.id, status: "approved", ...(await this.issue(g)) };
  }

  private async issue(g: Grant) {
    const token = randomBytes(32).toString("base64url");
    g.tokenHash = hash(token).toString("hex");
    g.expiresAt = new Date(this.now().getTime() + g.ttlSeconds * 1000);
    await this.deps.log.append(this.entry(g, "issued", g.id, g.approvedBy, `expires ${g.expiresAt.toISOString()}`));
    return { token, expiresAt: g.expiresAt };
  }

  /** Human decision for a critical grant. Returns the token to deliver to the waiting agent. */
  async decide(grantId: string, approver: string, approve: boolean): Promise<{ status: GrantStatus; token?: string; expiresAt?: Date }> {
    const g = this.grants.get(grantId);
    if (!g || g.status !== "pending_approval") throw new Error("broker: grant not awaiting approval");
    if (approver === g.agentId) throw new Error("broker: agents cannot approve their own grants");
    // A pending request older than 15 minutes expires instead of being approved.
    if (this.now().getTime() - g.createdAt.getTime() > 15 * 60_000) {
      g.status = "expired"; await this.deps.log.append(this.entry(g, "expired", g.id)); throw new Error("broker: approval window elapsed");
    }
    g.approvedBy = approver;
    if (!approve) { g.status = "denied"; await this.deps.log.append(this.entry(g, "denied", g.id, approver)); return { status: g.status }; }
    g.status = "approved"; await this.deps.log.append(this.entry(g, "approved", g.id, approver));
    return { status: g.status, ...(await this.issue(g)) };
  }

  /**
   * Redeem a grant exactly once. The broker decrypts the credential and passes
   * it to `call` (the provider request); only the call's result is returned.
   */
  async redeem<T>(input: { grantId: string; agentId: string; token: string; action: string }, call: (secret: string) => Promise<T>): Promise<T> {
    const g = this.grants.get(input.grantId);
    const reject = async (why: string) => {
      if (g) await this.deps.log.append(this.entry(g, why === "expired" ? "expired" : "redeem_rejected", g.id, null, why));
      throw new Error(`broker: redeem rejected (${why})`);
    };
    if (!g || g.status !== "approved" || !g.tokenHash || !g.expiresAt) return reject("not redeemable");
    if (g.agentId !== input.agentId) return reject("wrong agent");
    if (g.scope.action !== input.action) return reject("action outside scope");
    const a = hash(input.token), b = Buffer.from(g.tokenHash, "hex");
    if (!timingSafeEqual(a, b)) return reject("bad token");
    if (this.now() >= g.expiresAt) { g.status = "expired"; return reject("expired"); }
    g.status = "redeemed"; g.tokenHash = null; // single use, burned before the call
    await this.deps.log.append(this.entry(g, "redeemed", g.id));
    return this.deps.vault.withCredential(g.scope.orgId, g.scope.provider, g.scope.name, call);
  }

  /** Sweep: mark issued-but-unused grants past expiry as expired (run on a timer). */
  async expireStale(): Promise<number> {
    let n = 0;
    for (const g of this.grants.values()) {
      if (g.status === "approved" && g.expiresAt && this.now() >= g.expiresAt) {
        g.status = "expired"; g.tokenHash = null; n++; await this.deps.log.append(this.entry(g, "expired", g.id));
      }
    }
    return n;
  }

  getGrant(id: string): Readonly<Omit<Grant, "tokenHash">> | undefined {
    const g = this.grants.get(id); if (!g) return undefined;
    const { tokenHash: _t, ...rest } = g; return rest;
  }
}
