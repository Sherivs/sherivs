/**
 * Supabase adapters for WebAuthn persistence and the auth.users directory.
 * Service-role only. Never import from client modules except via dynamic
 * import inside createServerFn handlers.
 */
import { checkPublicRateLimit } from "@/lib/security/public-rate-limit.server";
import type { RateLimiter } from "@/lib/ai-gateway.server";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { originHostname, parseOnboardingStatus, parseWebAuthnConfig } from "./webauthn-policy";
import {
  candidateRpHosts,
  resolveCeremonyRelyingParty,
  selectSchoolDomainForHost,
  type SchoolDomainRpRecord,
} from "./webauthn-relying-party";
import {
  createSystemTimeAuthority,
  createWebAuthnService,
  type WebAuthnAuditor,
  type WebAuthnService,
} from "./webauthn.server";
import { createSupabaseWebAuthnSessionMinter } from "./webauthn-session.server";
import type {
  WebAuthnChallengeRecord,
  WebAuthnCredentialRecord,
  WebAuthnDirectory,
  WebAuthnPreferenceRecord,
  WebAuthnStore,
  WebAuthnUserProfile,
} from "./webauthn-store";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

type LooseQuery = {
  select(columns: string): LooseQuery;
  insert(row: Record<string, unknown>): LooseQuery;
  upsert(row: Record<string, unknown>, opts?: { onConflict?: string }): LooseQuery;
  update(row: Record<string, unknown>): LooseQuery;
  delete(): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: unknown[]): LooseQuery;
  order(column: string, opts: { ascending: boolean }): LooseQuery;
  maybeSingle(): RpcResult<Record<string, unknown>>;
  single(): RpcResult<Record<string, unknown>>;
  then: Promise<{ data: unknown; error: { message: string } | null }>["then"];
};

export type WebAuthnAdminClient = {
  from(table: string): LooseQuery;
  rpc(fn: string, args: Record<string, unknown>): RpcResult<unknown>;
  auth: Parameters<typeof createSupabaseWebAuthnSessionMinter>[0]["auth"];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function mapCredential(row: Record<string, unknown>): WebAuthnCredentialRecord {
  return {
    id: asString(row.id),
    userId: asString(row.user_id),
    credentialId: asString(row.credential_id),
    publicKey: asString(row.public_key),
    counter: asNumber(row.counter),
    deviceType: row.device_type === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: asBool(row.backed_up),
    transports: asStringArray(row.transports),
    aaguid: asStringOrNull(row.aaguid),
    label: asString(row.label) || "Passkey",
    rpId: asString(row.rp_id) || "sherivs.com",
    createdAt: asString(row.created_at),
    lastUsedAt: asStringOrNull(row.last_used_at),
  };
}

const CREDENTIAL_COLUMNS =
  "id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, aaguid, label, rp_id, created_at, last_used_at";

export function createSupabaseWebAuthnStore(admin: WebAuthnAdminClient): WebAuthnStore {
  return {
    async insertChallenge(row) {
      const { data, error } = await admin
        .from("webauthn_challenges")
        .insert({
          challenge: row.challenge,
          ceremony: row.ceremony,
          user_id: row.userId,
          rp_id: row.rpId,
          origin: row.origin,
          expires_at: new Date(row.expiresAtMs).toISOString(),
        })
        .select("id, challenge, ceremony, user_id, rp_id, origin, expires_at")
        .single();
      if (error || !data) throw new Error(error?.message ?? "challenge persist failed");
      return {
        id: asString(data.id),
        challenge: asString(data.challenge),
        ceremony: data.ceremony === "registration" ? "registration" : "authentication",
        userId: asStringOrNull(data.user_id),
        rpId: asString(data.rp_id),
        origin: asString(data.origin),
        expiresAtMs: Date.parse(asString(data.expires_at)),
      } satisfies WebAuthnChallengeRecord;
    },

    async consumeChallenge(challenge, ceremony, _nowMs) {
      const { data, error } = await admin.rpc("webauthn_consume_challenge", {
        p_challenge: challenge,
        p_ceremony: ceremony,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      return {
        id: asString(record.id),
        challenge,
        ceremony,
        userId: asStringOrNull(record.user_id),
        rpId: asString(record.rp_id),
        origin: asString(record.origin),
        expiresAtMs: Date.parse(asString(record.expires_at)),
      };
    },

    async listCredentials(userId, rpId) {
      let query = admin
        .from("webauthn_credentials")
        .select(CREDENTIAL_COLUMNS)
        .eq("user_id", userId);
      if (rpId) query = query.eq("rp_id", rpId);
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []).map((row) =>
        mapCredential(row as Record<string, unknown>),
      );
    },

    async getCredentialByCredentialId(credentialId) {
      const { data, error } = await admin
        .from("webauthn_credentials")
        .select(CREDENTIAL_COLUMNS)
        .eq("credential_id", credentialId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapCredential(data) : null;
    },

    async insertCredential(row) {
      const { data, error } = await admin
        .from("webauthn_credentials")
        .insert({
          user_id: row.userId,
          credential_id: row.credentialId,
          public_key: row.publicKey,
          counter: row.counter,
          device_type: row.deviceType,
          backed_up: row.backedUp,
          transports: row.transports,
          aaguid: row.aaguid,
          label: row.label,
          rp_id: row.rpId || "sherivs.com",
        })
        .select(CREDENTIAL_COLUMNS)
        .single();
      if (error || !data) {
        if (
          error?.message.toLowerCase().includes("duplicate") ||
          error?.message.includes("unique")
        ) {
          throw new Error("duplicate credential");
        }
        throw new Error(error?.message ?? "credential persist failed");
      }
      return mapCredential(data);
    },

    async updateCredential(id, userId, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.label !== undefined) payload.label = patch.label;
      if (patch.counter !== undefined) payload.counter = patch.counter;
      if (patch.lastUsedAt !== undefined) payload.last_used_at = patch.lastUsedAt;
      if (patch.backedUp !== undefined) payload.backed_up = patch.backedUp;
      if (patch.deviceType !== undefined) payload.device_type = patch.deviceType;
      const { data, error } = await admin
        .from("webauthn_credentials")
        .update(payload)
        .eq("id", id)
        .eq("user_id", userId)
        .select(CREDENTIAL_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapCredential(data) : null;
    },

    async deleteCredential(id, userId) {
      const { data, error } = await admin
        .from("webauthn_credentials")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },

    async countCredentials(userId, rpId) {
      const rows = await this.listCredentials(userId, rpId);
      return rows.length;
    },

    async getPreferences(userId) {
      const { data, error } = await admin
        .from("webauthn_preferences")
        .select("user_id, onboarding_status, passkey_first")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        userId: asString(data.user_id),
        onboardingStatus: parseOnboardingStatus(data.onboarding_status),
        passkeyFirst: data.passkey_first !== false,
      } satisfies WebAuthnPreferenceRecord;
    },

    async upsertPreferences(row) {
      const { data, error } = await admin
        .from("webauthn_preferences")
        .upsert(
          {
            user_id: row.userId,
            onboarding_status: row.onboardingStatus,
            passkey_first: row.passkeyFirst,
          },
          { onConflict: "user_id" },
        )
        .select("user_id, onboarding_status, passkey_first")
        .single();
      if (error || !data) throw new Error(error?.message ?? "preference persist failed");
      return {
        userId: asString(data.user_id),
        onboardingStatus: parseOnboardingStatus(data.onboarding_status),
        passkeyFirst: data.passkey_first !== false,
      };
    },
  };
}

export function createSupabaseWebAuthnDirectory(admin: WebAuthnAdminClient): WebAuthnDirectory {
  return {
    async getUser(userId: string): Promise<WebAuthnUserProfile | null> {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
      const user = authData?.user;
      if (authError || !user) return null;
      const { data: tenant } = await admin
        .from("users")
        .select("id, school_id, full_name")
        .eq("id", userId)
        .maybeSingle();
      const meta = (user as { user_metadata?: { full_name?: unknown } }).user_metadata;
      const displayName =
        asStringOrNull(tenant?.full_name) ??
        (typeof meta?.full_name === "string" ? meta.full_name : null);
      return {
        id: user.id,
        email: user.email ?? null,
        emailConfirmed: Boolean(user.email_confirmed_at),
        displayName,
        tenantUserId: asStringOrNull(tenant?.id),
        schoolId: asStringOrNull(tenant?.school_id),
      };
    },
  };
}

export function createWebAuthnAuditor(admin: WebAuthnAdminClient): WebAuthnAuditor {
  return async (event) => {
    if (!event.tenantUserId && !event.actorEmail) return;
    await writeAuditRecord(admin, {
      action: event.action,
      gate: "webauthn",
      tenantId: event.schoolId,
      actorId: event.tenantUserId,
      actorEmail: event.actorEmail,
      table: "webauthn_credentials",
      recordId: event.recordId,
      outcome: event.outcome,
      details: event.details,
    });
  };
}

const AUTH_LIMIT = { maxRequests: 10, windowMs: 60_000 } as const;

export function createWebAuthnRateLimiter(): RateLimiter {
  return {
    async check(refKey: string) {
      const limited = await checkPublicRateLimit("webauthn", refKey, AUTH_LIMIT);
      if (limited.allowed) return { decision: "allow" as const };
      return { decision: "deny" as const, retryAfterMs: limited.retryAfterSeconds * 1000 };
    },
  };
}

export async function lookupSchoolDomainForWebAuthn(
  admin: WebAuthnAdminClient,
  origin: string,
): Promise<SchoolDomainRpRecord | null> {
  const host = originHostname(origin);
  if (!host) return null;
  const candidates = candidateRpHosts(host);
  if (candidates.length === 0) return null;
  const { data, error } = await admin
    .from("school_domains")
    .select("hostname, status, school_id")
    .in("hostname", candidates);
  if (error || !Array.isArray(data)) return null;
  const rows: SchoolDomainRpRecord[] = data.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      hostname: asString(record.hostname).toLowerCase(),
      status: asString(record.status),
      schoolId: asString(record.school_id),
    };
  });
  return selectSchoolDomainForHost(host, rows);
}

export async function createProductionWebAuthnService(): Promise<WebAuthnService> {
  const parsed = parseWebAuthnConfig(process.env, {
    fallbackLocal: process.env.NODE_ENV !== "production",
  });
  if (!parsed.ok) {
    const { WebAuthnServiceError } = await import("./webauthn.server");
    throw new WebAuthnServiceError("unavailable", 503);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as WebAuthnAdminClient;
  const platform = parsed.config;
  return createWebAuthnService({
    store: createSupabaseWebAuthnStore(admin),
    directory: createSupabaseWebAuthnDirectory(admin),
    sessions: createSupabaseWebAuthnSessionMinter(admin),
    config: platform,
    resolveConfig: async (origin) => {
      const domain = await lookupSchoolDomainForWebAuthn(admin, origin);
      return resolveCeremonyRelyingParty({ origin, platform, domain });
    },
    time: createSystemTimeAuthority(),
    rateLimiter: createWebAuthnRateLimiter(),
    audit: createWebAuthnAuditor(admin),
  });
}

export function requestOrigin(request: Request): string {
  const header = request.headers.get("origin");
  if (header && header.length <= 300) return header;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
