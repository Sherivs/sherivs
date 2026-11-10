import { createHash, timingSafeEqual } from "node:crypto";
import { generateText, Output } from "ai";
import { z } from "zod";
import { HELP_ARTICLES } from "../public-site/help";
import { invokeAiGateway, AI_GATEWAY_FAILURE_POLICY } from "../ai-gateway.server";
import {
  aiGuardLimits,
  buildGuardedPrompt,
  guardAiOutput,
  redactSensitive,
} from "@/lib/ai/ai-guard.server";
import {
  AuditChain,
  type AuditInput,
  type ChainEntry,
  type ChainStore,
} from "../trust-ledger/hash-chain.server";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import {
  PLATFORM_VOICE_SUPPORT_NUMBER,
  PLATFORM_VOICE_TENANT_REF,
  voiceSttProviderFromEnv,
  voiceTtsProviderFromEnv,
} from "./voice-number-binding";

const timeAuthority = new TimeAuthority(new SystemClock());
const MAX_CALLBACK_BYTES = 16 * 1024;
const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_TURNS = 5;
const HUMAN_ESCALATION =
  /\b(?:human(?:\s+agent)?|real person|representative|speak to (?:a person|someone)|talk to (?:a person|someone))\b/i;
export const AFRICAS_TALKING_PROVIDER_ID = "africas_talking";
export const AFRICAS_TALKING_API_KEY_ENV = "AT_API_KEY";
export const AFRICAS_TALKING_USERNAME_ENV = "AT_USERNAME";
export const AFRICAS_TALKING_WEBHOOK_TOKEN_ENV = "AT_VOICE_WEBHOOK_TOKEN";
export const AFRICAS_TALKING_CALLBACK_URL_ENV = "AT_VOICE_CALLBACK_URL";

export type VoiceServerEnv = Record<string, string | undefined>;

export interface AfricaTalkingVoiceConfig {
  username: string;
  apiKey: string;
  webhookToken: string;
  callbackUrl: URL;
}

export function africaTalkingVoiceConfigFromEnv(
  env: VoiceServerEnv,
): AfricaTalkingVoiceConfig | null {
  const username = env[AFRICAS_TALKING_USERNAME_ENV]?.trim();
  const apiKey = env[AFRICAS_TALKING_API_KEY_ENV]?.trim();
  const webhookToken = env[AFRICAS_TALKING_WEBHOOK_TOKEN_ENV]?.trim();
  const callbackUrlValue = env[AFRICAS_TALKING_CALLBACK_URL_ENV]?.trim();
  if (
    !username ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(username) ||
    !apiKey ||
    apiKey.length > 1024 ||
    !callbackUrlValue ||
    !webhookToken ||
    webhookToken.length < 32 ||
    webhookToken.length > 256
  ) {
    return null;
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callbackUrlValue);
  } catch {
    return null;
  }
  if (callbackUrl.protocol !== "https:" || callbackUrl.username || callbackUrl.password)
    return null;
  callbackUrl.searchParams.set("token", webhookToken);
  return { username, apiKey, webhookToken, callbackUrl };
}

export function escapeVoiceXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function voiceXml(message: string, nextAction = "<Hangup/>"): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeVoiceXml(message)}</Say>${nextAction}</Response>`;
}

export function recordVoiceXml(message: string, callbackUrl: URL): string {
  const callback = escapeVoiceXml(callbackUrl.toString());
  return voiceXml(
    message,
    `<Record finishOnKey="#" timeout="8" maxLength="30" playBeep="true" callbackUrl="${callback}"/>`,
  );
}

export function consentVoiceXml(callbackUrl: URL): string {
  const callback = escapeVoiceXml(callbackUrl.toString());
  return voiceXml(
    "Welcome to Sherivs support. This call will be recorded and transcribed to answer your question. Press 1 to consent, or hang up to decline.",
    `<GetDigits numDigits="1" timeout="8" callbackUrl="${callback}"><Say>Press 1 to consent.</Say></GetDigits><Hangup/>`,
  );
}

export function dialHumanXml(phone: string = PLATFORM_VOICE_SUPPORT_NUMBER): string {
  if (phone !== PLATFORM_VOICE_SUPPORT_NUMBER) {
    throw new Error("Human escalation dials only the bound platform support line.");
  }
  return voiceXml(
    "Connecting you to a Sherivs support representative.",
    `<Dial phoneNumbers="${phone}"/>`,
  );
}

export function isHumanEscalationRequest(transcript: string): boolean {
  return HUMAN_ESCALATION.test(transcript);
}

export interface VoiceSession {
  id: string;
  tenant_id: string;
  tenant_ref: string | null;
  provider_session_id: string;
  caller_number: string;
  destination_number: string;
  state: "consent_pending" | "active" | "completed" | "escalated" | "declined" | "failed";
  recording_consent_at: string | null;
  turn_count: number;
}

interface DatabaseResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

function isMissingVoiceBindingColumn(error: { message: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .+ does not exist|schema cache/i.test(error.message);
}

interface VoiceQuery extends PromiseLike<DatabaseResult> {
  select(columns: string): VoiceQuery;
  eq(column: string, value: unknown): VoiceQuery;
  order(column: string, options: { ascending: boolean }): VoiceQuery;
  limit(count: number): VoiceQuery;
  maybeSingle(): PromiseLike<DatabaseResult>;
  insert(values: Record<string, unknown>): VoiceQuery;
  upsert(values: Record<string, unknown>, options?: Record<string, unknown>): VoiceQuery;
  update(values: Record<string, unknown>): VoiceQuery;
}

export interface VoiceCallbackDatabase {
  from(table: string): VoiceQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DatabaseResult>;
}

export interface VoiceSpeechToTextAdapter {
  readonly providerId: string;
  transcribe(recordingUrl: string, atApiKey: string): Promise<string>;
}

export interface VoiceLanguageAdapter {
  readonly providerId: string;
  answer(transcript: string, tenantRef: string, sessionId: string): Promise<string>;
}

export interface VoiceTextToSpeechAdapter {
  readonly providerId: string;
  speak(text: string, callbackUrl: URL): string;
}

export interface VoiceAssistant {
  transcriber: VoiceSpeechToTextAdapter;
  language: VoiceLanguageAdapter;
  speech: VoiceTextToSpeechAdapter;
}

export interface VoiceCallbackDependencies {
  env: VoiceServerEnv;
  db: VoiceCallbackDatabase;
  assistant: VoiceAssistant | null;
  audit?: (input: AuditInput) => Promise<unknown>;
  now?: () => string;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
}

const VoiceCallbackSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/),
  callerNumber: z.string().trim().max(20).optional(),
  destinationNumber: z.string().trim().max(20).optional(),
  direction: z.string().trim().max(20).optional(),
  dtmfDigits: z.string().trim().max(8).optional(),
  recordingUrl: z.string().trim().max(2048).optional(),
  isActive: z.string().trim().max(8).optional(),
  status: z.string().trim().max(30).optional(),
});

const VoiceSessionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  tenant_ref: z.string().uuid().nullable(),
  provider_session_id: z.string().min(1).max(160),
  caller_number: z.string().min(1).max(20),
  destination_number: z.string().min(1).max(20),
  state: z.enum(["consent_pending", "active", "completed", "escalated", "declined", "failed"]),
  recording_consent_at: z.string().nullable(),
  turn_count: z.number().int().min(0).max(MAX_VOICE_TURNS),
});

const SESSION_COLUMNS =
  "id,tenant_id,tenant_ref,provider_session_id,caller_number,destination_number,state,recording_consent_at,turn_count";

async function findSession(
  db: VoiceCallbackDatabase,
  sessionId: string,
): Promise<VoiceSession | null> {
  const result = await db
    .from("voice_call_sessions")
    .select(SESSION_COLUMNS)
    .eq("provider_session_id", sessionId)
    .maybeSingle();
  if (result.error) throw new Error("voice session lookup failed");
  if (result.data === null) return null;
  return VoiceSessionSchema.parse(result.data);
}

interface ResolvedVoiceTenant {
  schoolId: string;
  tenantRef: string | null;
}

async function resolveTenant(
  db: VoiceCallbackDatabase,
  destination: string,
): Promise<ResolvedVoiceTenant | null> {
  const neutral = await db
    .from("cg_org_communication_sender")
    .select("tenant_id")
    .eq("channel", "voice")
    .eq("provider", AFRICAS_TALKING_PROVIDER_ID)
    .eq("status", "active")
    .eq("from_number", destination)
    .maybeSingle();
  if (neutral.error) throw new Error("voice destination lookup failed");
  if (neutral.data !== null) {
    const sender = z.object({ tenant_id: z.string().uuid() }).parse(neutral.data);
    const setting = await db
      .from("cg_org_voice_agent")
      .select("enabled")
      .eq("tenant_ref", sender.tenant_id)
      .maybeSingle();
    if (setting.error) throw new Error("voice agent configuration lookup failed");
    if (setting.data === null || (setting.data as { enabled?: unknown }).enabled !== true)
      return null;
    const mapping = await db
      .from("school_tenant_map")
      .select("school_id")
      .eq("tenant_id", sender.tenant_id)
      .maybeSingle();
    if (mapping.error) throw new Error("voice tenant mapping lookup failed");
    const parsedMapping = z.object({ school_id: z.string().uuid() }).safeParse(mapping.data);
    return parsedMapping.success
      ? { schoolId: parsedMapping.data.school_id, tenantRef: sender.tenant_id }
      : null;
  }

  const result = await db
    .from("comms_sender_numbers")
    .select("school_id,org_id,binding_role,tenant_ref,number_status")
    .eq("channel", "voice")
    .eq("provider", AFRICAS_TALKING_PROVIDER_ID)
    .eq("provider_number", destination)
    .maybeSingle();
  if (result.error) {
    if (!isMissingVoiceBindingColumn(result.error)) {
      throw new Error("voice destination lookup failed");
    }
    const legacy = await db
      .from("comms_sender_numbers")
      .select("school_id")
      .eq("channel", "voice")
      .eq("provider", AFRICAS_TALKING_PROVIDER_ID)
      .eq("provider_number", destination)
      .maybeSingle();
    if (legacy.error || legacy.data === null) return null;
    const legacyRow = z.object({ school_id: z.string().uuid() }).safeParse(legacy.data);
    return legacyRow.success ? { schoolId: legacyRow.data.school_id, tenantRef: null } : null;
  }
  const parsed = z
    .object({
      school_id: z.string().uuid().nullable().optional(),
      org_id: z.string().uuid().nullable().optional(),
      binding_role: z.enum(["platform_support", "organization"]).nullable().optional(),
      tenant_ref: z.string().uuid().nullable().optional(),
      number_status: z.enum(["active", "suspended"]).nullable().optional(),
    })
    .safeParse(result.data);
  if (!parsed.success || parsed.data.number_status === "suspended") return null;
  const row = parsed.data;
  if (row.org_id && row.school_id && row.org_id !== row.school_id) return null;
  const schoolId = row.school_id ?? row.org_id ?? null;
  if (row.binding_role === "platform_support") {
    if (row.tenant_ref !== PLATFORM_VOICE_TENANT_REF) return null;
    const mapping = await db
      .from("school_tenant_map")
      .select("school_id")
      .eq("tenant_id", PLATFORM_VOICE_TENANT_REF)
      .maybeSingle();
    if (mapping.error) return null;
    const mapped = z.object({ school_id: z.string().uuid() }).safeParse(mapping.data);
    return mapped.success
      ? { schoolId: mapped.data.school_id, tenantRef: PLATFORM_VOICE_TENANT_REF }
      : null;
  }
  return schoolId ? { schoolId, tenantRef: row.tenant_ref ?? null } : null;
}

async function loadPlatformSupportNumber(db: VoiceCallbackDatabase): Promise<string | null> {
  const result = await db
    .from("comms_sender_numbers")
    .select("provider_number,binding_role,number_status")
    .eq("channel", "voice")
    .eq("provider", AFRICAS_TALKING_PROVIDER_ID)
    .eq("binding_role", "platform_support")
    .eq("number_status", "active")
    .maybeSingle();
  if (result.error || result.data === null) return null;
  if (result.data === null) return null;
  const parsed = z
    .object({
      provider_number: z.literal(PLATFORM_VOICE_SUPPORT_NUMBER),
      binding_role: z.literal("platform_support"),
    })
    .safeParse(result.data);
  return parsed.success ? parsed.data.provider_number : null;
}

async function dialBoundPlatformSupport(db: VoiceCallbackDatabase): Promise<Response> {
  const platformNumber = await loadPlatformSupportNumber(db);
  if (!platformNumber) {
    return responseXml(voiceXml("A support representative is not available on this line."));
  }
  return responseXml(dialHumanXml(platformNumber));
}

async function featureEnabled(db: VoiceCallbackDatabase, tenantId: string): Promise<boolean> {
  const result = await db.rpc("flag_on", { p_key: "voice_live", p_org: tenantId });
  return result.error === null && result.data === true;
}

async function createSession(
  db: VoiceCallbackDatabase,
  callback: z.infer<typeof VoiceCallbackSchema>,
  tenantId: string,
  tenantRef: string | null,
  now: string,
): Promise<VoiceSession> {
  const row = {
    tenant_id: tenantId,
    tenant_ref: tenantRef,
    provider: AFRICAS_TALKING_PROVIDER_ID,
    provider_session_id: callback.sessionId,
    caller_number: callback.callerNumber,
    destination_number: callback.destinationNumber,
    state: "consent_pending",
    turn_count: 0,
    created_at: now,
    updated_at: now,
  };
  const insert = await db
    .from("voice_call_sessions")
    .insert(row)
    .select(SESSION_COLUMNS)
    .maybeSingle();
  if (!insert.error && insert.data !== null) return VoiceSessionSchema.parse(insert.data);
  const existing = await findSession(db, callback.sessionId);
  if (existing) return existing;
  throw new Error("voice session creation failed");
}

async function updateSession(
  db: VoiceCallbackDatabase,
  session: VoiceSession,
  values: Record<string, unknown>,
): Promise<void> {
  const result = await db
    .from("voice_call_sessions")
    .update(values)
    .eq("id", session.id)
    .eq("tenant_id", session.tenant_id);
  if (result.error) throw new Error("voice session update failed");
}

async function recordCommsEvent(
  db: VoiceCallbackDatabase,
  session: VoiceSession,
  body: string,
  action: string,
  suffix: string,
): Promise<void> {
  const providerRef = voiceEventProviderRef(session, suffix);
  const result = await db.rpc("comms_inbound", {
    p_school: session.tenant_id,
    p_channel: "voice",
    p_from: session.caller_number,
    p_body: `[voice:${action}] ${body}`.slice(0, 2000),
    p_provider_ref: providerRef,
  });
  if (result.error) throw new Error("voice communication log write failed");
}

function voiceEventProviderRef(session: VoiceSession, suffix: string): string {
  return `at-voice:${createHash("sha256")
    .update(`${session.provider_session_id}|${suffix}`)
    .digest("hex")}`;
}

function createPostgresChainStore(db: VoiceCallbackDatabase): ChainStore {
  const columns =
    "org_id,seq,at,actor_kind,actor_id,action,target_type,target_id,ip,device,before_hash,after_hash,prev_hash,entry_hash";
  const fromRow = (row: unknown): ChainEntry => {
    const parsed = z
      .object({
        org_id: z.string().uuid(),
        seq: z.union([z.number(), z.string()]),
        at: z.string(),
        actor_kind: z.enum(["user", "agent", "system"]),
        actor_id: z.string(),
        action: z.string(),
        target_type: z.string(),
        target_id: z.string(),
        ip: z.string().nullable(),
        device: z.string().nullable(),
        before_hash: z.string().nullable(),
        after_hash: z.string().nullable(),
        prev_hash: z.string(),
        entry_hash: z.string(),
      })
      .parse(row);
    return {
      orgId: parsed.org_id,
      seq: Number(parsed.seq),
      at: parsed.at,
      actorKind: parsed.actor_kind,
      actorId: parsed.actor_id,
      action: parsed.action,
      targetType: parsed.target_type,
      targetId: parsed.target_id,
      ip: parsed.ip,
      device: parsed.device,
      beforeHash: parsed.before_hash,
      afterHash: parsed.after_hash,
      prevHash: parsed.prev_hash,
      entryHash: parsed.entry_hash,
    };
  };
  const toRow = (entry: ChainEntry) => ({
    org_id: entry.orgId,
    seq: entry.seq,
    at: entry.at,
    actor_kind: entry.actorKind,
    actor_id: entry.actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    ip: entry.ip,
    device: entry.device,
    before_hash: entry.beforeHash,
    after_hash: entry.afterHash,
    prev_hash: entry.prevHash,
    entry_hash: entry.entryHash,
  });
  return {
    async head(orgId) {
      const result = await db
        .from("audit_chain")
        .select(columns)
        .eq("org_id", orgId)
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) throw new Error("audit-chain head lookup failed");
      return result.data === null ? null : fromRow(result.data);
    },
    async append(entry) {
      const result = await db.from("audit_chain").insert(toRow(entry));
      if (result.error) throw new Error("audit-chain append failed");
    },
    async list(orgId) {
      const result = await db
        .from("audit_chain")
        .select(columns)
        .eq("org_id", orgId)
        .order("seq", { ascending: true });
      if (result.error || !Array.isArray(result.data)) throw new Error("audit-chain list failed");
      return result.data.map(fromRow);
    },
  };
}

export function createAfricaTalkingOutboundCallHandler(dependencies: {
  env: VoiceServerEnv;
  db: VoiceCallbackDatabase;
}) {
  const config = africaTalkingVoiceConfigFromEnv(dependencies.env);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!config) return responseXml(voiceXml("This call is not available."), 503);
    const requestUrl = new URL(request.url);
    const callbackToken = requestUrl.searchParams.get("token") ?? "";
    const callId = z.string().uuid().safeParse(requestUrl.searchParams.get("call_id"));
    if (!safeEqual(callbackToken, config.webhookToken) || !callId.success) {
      return new Response("Forbidden", { status: 403 });
    }
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/x-www-form-urlencoded")
    ) {
      return new Response("Unsupported media type", { status: 415 });
    }
    let raw: string | null;
    try {
      raw = await readBoundedText(request, MAX_CALLBACK_BYTES);
    } catch {
      return new Response("Invalid request body", { status: 400 });
    }
    if (raw === null) return new Response("Payload too large", { status: 413 });
    const fields = new URLSearchParams(raw);
    const callback = VoiceCallbackSchema.safeParse({
      sessionId: fields.get("sessionId"),
      callerNumber: fields.get("callerNumber") ?? undefined,
      destinationNumber: fields.get("destinationNumber") ?? undefined,
      direction: fields.get("direction") ?? undefined,
      status: fields.get("status") ?? undefined,
    });
    if (!callback.success) return responseXml(voiceXml("This call is not available."), 400);
    try {
      const approvalResult = await dependencies.db
        .from("cg_voice_call_approvals")
        .select("tenant_ref,recipient_phone,script,status,provider_call_id")
        .eq("id", callId.data)
        .maybeSingle();
      const approval = z
        .object({
          tenant_ref: z.string().uuid(),
          recipient_phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
          script: z.string().min(1).max(500),
          status: z.enum(["dispatching", "completed"]),
          provider_call_id: z.string().nullable(),
        })
        .safeParse(approvalResult.data);
      if (
        approvalResult.error ||
        !approval.success ||
        (approval.data.provider_call_id !== null &&
          approval.data.provider_call_id !== callback.data.sessionId) ||
        callback.data.direction?.toLowerCase() !== "outbound" ||
        callback.data.destinationNumber !== approval.data.recipient_phone
      ) {
        return responseXml(voiceXml("This call could not be verified."), 403);
      }

      const senderResult = await dependencies.db
        .from("cg_org_communication_sender")
        .select("from_number")
        .eq("tenant_id", approval.data.tenant_ref)
        .eq("org_ref", approval.data.tenant_ref)
        .eq("channel", "voice")
        .eq("provider", AFRICAS_TALKING_PROVIDER_ID)
        .eq("status", "active")
        .maybeSingle();
      const sender = z
        .object({ from_number: z.string().regex(/^\+[1-9][0-9]{7,14}$/) })
        .safeParse(senderResult.data);
      if (
        senderResult.error ||
        !sender.success ||
        callback.data.callerNumber !== sender.data.from_number
      ) {
        return responseXml(voiceXml("This call could not be verified."), 403);
      }
      return responseXml(voiceXml(approval.data.script));
    } catch {
      return responseXml(voiceXml("This call is temporarily unavailable."), 503);
    }
  };
}

function auditRecorder(db: VoiceCallbackDatabase, username: string) {
  const chain = new AuditChain(createPostgresChainStore(db));
  return (input: AuditInput) =>
    chain.record({
      ...input,
      actorKind: "system",
      actorId: `africas_talking:${username}`,
    });
}

function voiceAudit(
  audit: (input: AuditInput) => Promise<unknown>,
  session: VoiceSession,
  action: string,
  before: unknown,
  after: unknown,
): Promise<unknown> {
  return audit({
    orgId: session.tenant_ref ?? session.tenant_id,
    actorKind: "system",
    actorId: "africas_talking",
    action,
    targetType: "voice_call_session",
    targetId: session.id,
    before,
    after,
  });
}

function validRecordingUrl(recordingUrl: string): URL | null {
  try {
    const url = new URL(recordingUrl);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !(host === "africastalking.com" || host.endsWith(".africastalking.com"))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function boundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("provider response too large");
  if (!response.body) throw new Error("provider response missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("provider response too large");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const bytes = await boundedResponseBytes(response, maxBytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function createOpenAiTranscriber(
  env: VoiceServerEnv,
  fetcher: typeof fetch,
): VoiceSpeechToTextAdapter | null {
  const apiKey = env.VOICE_STT_API_KEY?.trim();
  if (voiceSttProviderFromEnv(env) !== "openai" || !apiKey) return null;
  let baseUrl: URL;
  try {
    baseUrl = new URL(env.VOICE_STT_BASE_URL?.trim() || "https://api.openai.com/v1");
  } catch {
    return null;
  }
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    return null;
  }
  const endpoint = new URL("audio/transcriptions", baseUrl.toString().replace(/\/?$/, "/"));

  return {
    providerId: "openai",
    async transcribe(recordingUrl, atApiKey) {
      const mediaUrl = validRecordingUrl(recordingUrl);
      if (!mediaUrl) throw new Error("unsupported voice recording URL");
      const media = await fetcher(mediaUrl, {
        headers: { apiKey: atApiKey, Accept: "audio/*" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!media.ok) throw new Error("voice recording could not be retrieved");
      const contentType = media.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!contentType?.startsWith("audio/")) throw new Error("voice recording is not audio");
      const audio = await boundedResponseBytes(media, MAX_RECORDING_BYTES);
      const form = new FormData();
      const audioBuffer = new ArrayBuffer(audio.byteLength);
      new Uint8Array(audioBuffer).set(audio);
      form.set("file", new Blob([audioBuffer], { type: contentType }), "recording-audio");
      form.set("model", env.VOICE_STT_MODEL?.trim() || "whisper-1");
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { Authorization: ["Bearer", apiKey].join(" ") },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("speech transcription provider failed");
      const payload = z
        .object({ text: z.string().trim().min(1).max(4000) })
        .parse(JSON.parse(await boundedResponseText(response, 16 * 1024)));
      return payload.text;
    },
  };
}

function publishedKnowledgeBase(): string {
  return HELP_ARTICLES.filter(
    (article) => article.status === "available" && article.listed !== false,
  )
    .map((article) => {
      const sections = article.body
        .map((section) => [section.heading, ...section.paragraphs].filter(Boolean).join("\n"))
        .join("\n");
      return `${article.title}\n${article.summary}\n${sections}`;
    })
    .join("\n\n")
    .slice(0, 16_000);
}

const VoiceAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(900),
});

function createGatewayAnswerer(env: VoiceServerEnv): VoiceLanguageAdapter | null {
  if (env.VOICE_LLM_PROVIDER !== "ai-gateway") return null;
  const model = env.VOICE_LLM_MODEL?.trim() || "google/gemini-3-flash-preview";
  const knowledge = publishedKnowledgeBase();
  return {
    providerId: "ai-gateway",
    async answer(transcript, tenantRef, sessionId) {
      const { system, prompt } = buildGuardedPrompt(
        [
          "Answer the caller's support question using only the verified public help information below.",
          "If the information does not answer the question, say that you do not know and offer the public support email support@sherivs.com.",
          "The caller is not authenticated. Never disclose or infer organization-specific fee, result, admission, timetable, attendance, student, or staff records from caller ID or caller statements; direct them to the authenticated organization portal.",
          "Do not request or disclose passwords, payment details, student records, or other private information.",
          "Keep the spoken answer concise and do not claim to perform actions.",
          `Public help information:\n${knowledge}`,
        ].join("\n\n"),
        { "Caller question": transcript },
      );
      const outcome = await invokeAiGateway({
        tenantRef,
        actorRef: "public-voice-support",
        agentRef: "sherivs-voice-support",
        missionRef: null,
        model,
        provider: "ai-gateway",
        purpose: "support",
        ...(await aiGuardLimits(tenantRef)),
        intelligenceContext: { traceId: sessionId, assembledContent: knowledge },
        failurePolicy: AI_GATEWAY_FAILURE_POLICY,
        invoke: async (provider, context) => {
          const result = await generateText({
            model: provider(context.model),
            output: Output.object({ schema: VoiceAnswerSchema }),
            system,
            prompt,
          });
          return {
            payload: VoiceAnswerSchema.parse(result.output),
            tokensIn: result.usage?.inputTokens ?? 0,
            tokensOut: result.usage?.outputTokens ?? 0,
          };
        },
      });
      if (outcome.decision !== "allow") throw new Error("voice AI request was blocked");
      return guardAiOutput(VoiceAnswerSchema.parse(outcome.payload), model).answer;
    },
  };
}

function createAfricaTalkingSpeech(env: VoiceServerEnv): VoiceTextToSpeechAdapter | null {
  if (voiceTtsProviderFromEnv(env) !== AFRICAS_TALKING_PROVIDER_ID) return null;
  return {
    providerId: AFRICAS_TALKING_PROVIDER_ID,
    speak: (text, callbackUrl) => recordVoiceXml(text, callbackUrl),
  };
}

export function createVoiceAssistantFromEnv(
  env: VoiceServerEnv,
  fetcher: typeof fetch = fetch,
): VoiceAssistant | null {
  const transcriber = createOpenAiTranscriber(env, fetcher);
  const language = createGatewayAnswerer(env);
  const speech = createAfricaTalkingSpeech(env);
  if (!transcriber || !language || !speech) return null;
  return { transcriber, language, speech };
}

function responseXml(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

function eventExists(db: VoiceCallbackDatabase, ref: string): PromiseLike<DatabaseResult> {
  return db
    .from("inbound_messages")
    .select("id")
    .eq("channel", "voice")
    .eq("provider_ref", ref)
    .maybeSingle();
}

export function createAfricaTalkingVoiceCallbackHandler(dependencies: VoiceCallbackDependencies) {
  const { env, db } = dependencies;
  const config = africaTalkingVoiceConfigFromEnv(env);
  const now = dependencies.now ?? (() => timeAuthority.now().at);
  const audit = dependencies.audit ?? auditRecorder(db, config?.username ?? "unconfigured");
  const assistant = dependencies.assistant;

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!config) return responseXml(voiceXml("This support line is not configured."), 503);
    const requestUrl = new URL(request.url);
    const callbackToken = requestUrl.searchParams.get("token") ?? "";
    if (callbackToken.length > 256 || !safeEqual(callbackToken, config.webhookToken)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/x-www-form-urlencoded")
    ) {
      return new Response("Unsupported media type", { status: 415 });
    }
    let raw: string | null;
    try {
      raw = await readBoundedText(request, MAX_CALLBACK_BYTES);
    } catch {
      return new Response("Invalid request body", { status: 400 });
    }
    if (raw === null) return new Response("Payload too large", { status: 413 });
    const fields = new URLSearchParams(raw);
    const parsed = VoiceCallbackSchema.safeParse({
      sessionId: fields.get("sessionId"),
      callerNumber: fields.get("callerNumber") ?? undefined,
      destinationNumber: fields.get("destinationNumber") ?? undefined,
      direction: fields.get("direction") ?? undefined,
      dtmfDigits: fields.get("dtmfDigits") ?? undefined,
      recordingUrl: fields.get("recordingUrl") ?? undefined,
      isActive: fields.get("isActive") ?? undefined,
    });
    if (!parsed.success) return responseXml(voiceXml("We could not process this call."), 400);
    const callback = parsed.data;
    let activeSession: VoiceSession | null = null;
    try {
      let session = await findSession(db, callback.sessionId);
      if (session) {
        if (
          (callback.callerNumber && callback.callerNumber !== session.caller_number) ||
          (callback.destinationNumber && callback.destinationNumber !== session.destination_number)
        ) {
          return responseXml(voiceXml("We could not verify this call."), 403);
        }
      } else {
        if (
          (callback.direction && callback.direction.toLowerCase() !== "inbound") ||
          !callback.callerNumber ||
          !callback.destinationNumber ||
          !/^\+?[0-9]{7,20}$/.test(callback.callerNumber) ||
          !/^\+?[0-9]{7,20}$/.test(callback.destinationNumber)
        ) {
          return responseXml(voiceXml("We could not route this call."));
        }
        const tenant = await resolveTenant(db, callback.destinationNumber);
        if (!tenant) return responseXml(voiceXml("This number is not available."));
        if (!(await featureEnabled(db, tenant.schoolId))) {
          return responseXml(voiceXml("This support line is currently unavailable."));
        }
        session = await createSession(db, callback, tenant.schoolId, tenant.tenantRef, now());
        await recordCommsEvent(
          db,
          session,
          "Inbound support call started.",
          "call_started",
          "call-start",
        );
        await voiceAudit(audit, session, "voice.call.started", null, { state: session.state });
      }
      activeSession = session;

      if (!(await featureEnabled(db, session.tenant_id))) {
        if (session.state === "consent_pending" || session.state === "active") {
          const endedAt = now();
          await updateSession(db, session, {
            state: "failed",
            updated_at: endedAt,
            ended_at: endedAt,
          });
          await recordCommsEvent(
            db,
            session,
            "Voice support was disabled during the call.",
            "call_failed",
            `feature-disabled-${session.state}`,
          );
          await voiceAudit(
            audit,
            session,
            "voice.call.failed",
            { state: session.state },
            { state: "failed", reason: "voice_live disabled" },
          );
        }
        return responseXml(voiceXml("This support line is currently unavailable."));
      }

      if (
        !callback.recordingUrl &&
        (callback.isActive === "0" || callback.isActive?.toLowerCase() === "false")
      ) {
        const endedAt = now();
        const declined = session.state === "consent_pending";
        const nextState = declined ? "declined" : "completed";
        await updateSession(db, session, {
          state: nextState,
          updated_at: endedAt,
          ended_at: endedAt,
        });
        await recordCommsEvent(
          db,
          session,
          declined ? "Caller did not provide recording consent." : "Inbound support call ended.",
          declined ? "consent_declined" : "call_completed",
          declined ? "consent-timeout" : "call-ended",
        );
        await voiceAudit(
          audit,
          session,
          declined ? "voice.call.consent_declined" : "voice.call.completed",
          { state: session.state },
          { state: nextState },
        );
        return responseXml(voiceXml("Thank you for calling Sherivs support."));
      }

      if (session.state === "consent_pending") {
        if (callback.dtmfDigits === "1") {
          const consentAt = now();
          await updateSession(db, session, {
            state: "active",
            recording_consent_at: consentAt,
            updated_at: consentAt,
          });
          await recordCommsEvent(
            db,
            session,
            "Caller consented to recording and transcription.",
            "consent_granted",
            "consent-granted",
          );
          await voiceAudit(
            audit,
            session,
            "voice.call.consent_granted",
            { state: "consent_pending" },
            { state: "active", consentedAt: consentAt },
          );
          return responseXml(
            recordVoiceXml(
              "Thank you. Please briefly describe how we can help you.",
              config.callbackUrl,
            ),
          );
        }
        if (callback.dtmfDigits) {
          const endedAt = now();
          await updateSession(db, session, {
            state: "declined",
            updated_at: endedAt,
            ended_at: endedAt,
          });
          await recordCommsEvent(
            db,
            session,
            "Caller declined recording consent.",
            "consent_declined",
            "consent-declined",
          );
          await voiceAudit(
            audit,
            session,
            "voice.call.consent_declined",
            { state: "consent_pending" },
            { state: "declined" },
          );
          return responseXml(
            voiceXml("Recording consent is required for this support line. Goodbye."),
          );
        }
        return responseXml(consentVoiceXml(config.callbackUrl));
      }

      if (session.state !== "active" || session.recording_consent_at === null) {
        return responseXml(voiceXml("This call has ended. Goodbye."));
      }
      if (callback.dtmfDigits === "0") {
        const endedAt = now();
        await updateSession(db, session, {
          state: "escalated",
          updated_at: endedAt,
          ended_at: endedAt,
        });
        await recordCommsEvent(
          db,
          session,
          "Caller requested a human representative.",
          "escalated",
          "escalated",
        );
        await voiceAudit(
          audit,
          session,
          "voice.call.escalated",
          { state: "active" },
          { state: "escalated" },
        );
        return dialBoundPlatformSupport(db);
      }
      if (callback.recordingUrl) {
        if (!assistant) throw new Error("voice AI providers are not configured");
        const eventHash = createHash("sha256")
          .update(`${session.provider_session_id}|${callback.recordingUrl}`)
          .digest("hex");
        const transcriptRef = voiceEventProviderRef(session, eventHash);
        const priorEvent = await eventExists(db, transcriptRef);
        if (priorEvent.error) throw new Error("voice replay lookup failed");
        if (priorEvent.data !== null) {
          return responseXml(
            recordVoiceXml(
              "We could not finish that response. Please ask your question again.",
              config.callbackUrl,
            ),
          );
        }
        const transcript = await assistant.transcriber.transcribe(
          callback.recordingUrl,
          config.apiKey,
        );
        if (isHumanEscalationRequest(transcript)) {
          await recordCommsEvent(db, session, transcript, "caller_transcript", eventHash);
          await voiceAudit(audit, session, "voice.transcript.caller_recorded", null, {
            providerEventHash: eventHash,
            transcriptHash: createHash("sha256").update(transcript).digest("hex"),
            transcriptLength: transcript.length,
          });
          const endedAt = now();
          await updateSession(db, session, {
            state: "escalated",
            updated_at: endedAt,
            ended_at: endedAt,
          });
          await recordCommsEvent(
            db,
            session,
            "Caller requested a human representative.",
            "escalated",
            `escalated-${eventHash}`,
          );
          await voiceAudit(
            audit,
            session,
            "voice.call.escalated",
            { state: "active" },
            { state: "escalated" },
          );
          return dialBoundPlatformSupport(db);
        }
        await recordCommsEvent(db, session, transcript, "caller_transcript", eventHash);
        await voiceAudit(audit, session, "voice.transcript.caller_recorded", null, {
          providerEventHash: eventHash,
          transcriptHash: createHash("sha256").update(transcript).digest("hex"),
          transcriptLength: transcript.length,
        });
        const answer = await assistant.language.answer(
          redactSensitive(transcript),
          session.tenant_ref ?? session.tenant_id,
          session.id,
        );
        await recordCommsEvent(db, session, answer, "assistant_response", `assistant-${eventHash}`);
        await voiceAudit(audit, session, "voice.transcript.assistant_recorded", null, {
          providerEventHash: eventHash,
          answerHash: createHash("sha256").update(answer).digest("hex"),
          answerLength: answer.length,
        });
        const turnCount = session.turn_count + 1;
        if (turnCount >= MAX_VOICE_TURNS) {
          const endedAt = now();
          await updateSession(db, session, {
            state: "completed",
            turn_count: turnCount,
            updated_at: endedAt,
            ended_at: endedAt,
          });
          await recordCommsEvent(
            db,
            session,
            "Conversation turn limit reached.",
            "call_completed",
            `completed-${eventHash}`,
          );
          await voiceAudit(
            audit,
            session,
            "voice.call.completed",
            { state: "active", turnCount: session.turn_count },
            { state: "completed", turnCount },
          );
          return responseXml(voiceXml(answer));
        }
        await updateSession(db, session, { turn_count: turnCount, updated_at: now() });
        await voiceAudit(
          audit,
          session,
          "voice.call.turn_completed",
          { state: "active", turnCount: session.turn_count },
          { state: "active", turnCount },
        );
        return responseXml(assistant.speech.speak(answer, config.callbackUrl));
      }
      return responseXml(
        recordVoiceXml(
          "Please tell us your next question, or say 'human representative' to speak to our team.",
          config.callbackUrl,
        ),
      );
    } catch {
      if (activeSession) {
        try {
          const endedAt = now();
          await updateSession(db, activeSession, {
            state: "failed",
            updated_at: endedAt,
            ended_at: endedAt,
          });
          await recordCommsEvent(
            db,
            activeSession,
            "Voice support processing failed.",
            "call_failed",
            `failed-${endedAt}`,
          );
          await voiceAudit(
            audit,
            activeSession,
            "voice.call.failed",
            { state: activeSession.state },
            { state: "failed" },
          );
        } catch {
          // A failed audit or database write must never produce a false success.
        }
      }
      return responseXml(
        voiceXml(
          "We are unable to continue this call right now. Please contact support@sherivs.com.",
        ),
        500,
      );
    }
  };
}
