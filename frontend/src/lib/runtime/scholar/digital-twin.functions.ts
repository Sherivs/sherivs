/**
 * Digital Twin server functions.
 *
 * Admin-only RPCs to manage a school's AI voice twin config and to
 * place / log outbound calls via Twilio. When the Twilio connector is
 * not linked, `placeTwinCall` records a "stub" call row so the UI flow
 * can be exercised end-to-end and returns a clear message; no fake
 * Twilio response is fabricated.
 *
 * MH-02 validation hardening: the `digital_twin_config` JSON columns
 * (`school_knowledge`, `trigger_rules`) are governed by the versioned
 * `TwinPayloadEnvelope` contract — known fields are validated, the open
 * part of the payload is explicitly structured as a bounded JSON tree
 * (depth-, collection- and size-capped), and the provider response is
 * schema-validated before use (untrusted output, §21). Nothing permissive.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import type { Json } from "@/integrations/supabase/types";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ---------------- Twin payload contract (MH-02) ----------------

/** Envelope version — bumped when the twin-payload shape changes. */
const TWIN_PAYLOAD_VERSION = 1;

/** Contract bounds: a payload is data, not an unbounded structure (§19 minimization). */
const TWIN_JSON_MAX_DEPTH = 8;
const TWIN_JSON_MAX_COLLECTION = 128;
const TWIN_JSON_MAX_STRING = 4000;
const TWIN_JSON_MAX_SERIALIZED = 65536;

/** Leaf scalars only — no nested escape hatch to an unbounded string. */
const JsonScalar = z.union([
  z.string().max(TWIN_JSON_MAX_STRING),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/**
 * Explicitly structured JSON tree: scalars at the leaves, arrays and
 * string-keyed records as the only composites, every level bounded.
 * This replaces the permissive untyped contracts — the unknown part of a
 * payload is still contracted.
 */
function boundedJsonTree(maxDepth: number): z.ZodType<Json> {
  if (maxDepth <= 0) return JsonScalar;
  return z.union([
    JsonScalar,
    z.array(boundedJsonTree(maxDepth - 1)).max(TWIN_JSON_MAX_COLLECTION),
    z.record(z.string(), boundedJsonTree(maxDepth - 1)),
  ]);
}

/**
 * Versioned twin-payload envelope: `version` is a known, validated field;
 * every other key must still satisfy the bounded JSON tree, and the whole
 * payload must stay under the serialized-size cap. Nothing is permissive.
 */
export const TwinPayloadEnvelope = z
  .object({
    version: z.literal(TWIN_PAYLOAD_VERSION).default(TWIN_PAYLOAD_VERSION),
  })
  .catchall(boundedJsonTree(TWIN_JSON_MAX_DEPTH))
  .refine((value) => (JSON.stringify(value) ?? "").length <= TWIN_JSON_MAX_SERIALIZED, {
    message: `twin payload exceeds the ${TWIN_JSON_MAX_SERIALIZED}-byte serialized limit`,
  });

// ---------------- Save config ----------------

export const ConfigInput = z.object({
  twin_name: z.string().trim().min(1).max(80),
  twin_voice: z.string().trim().min(1).max(40),
  twin_personality: z.string().trim().min(1).max(2000),
  school_knowledge: TwinPayloadEnvelope.default({ version: TWIN_PAYLOAD_VERSION }),
  trigger_rules: TwinPayloadEnvelope.default({ version: TWIN_PAYLOAD_VERSION }),
  is_active: z.boolean().default(true),
});

export const saveTwinConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => ConfigInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: existing } = await supabase
      .from("digital_twin_config")
      .select("id")
      .eq("school_id", schoolId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("digital_twin_config")
        .update({ ...data, updated_at: timeAuthority.now().at })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id, updated: true };
    }
    const { data: ins, error } = await supabase
      .from("digital_twin_config")
      .insert({ ...data, school_id: schoolId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins.id, updated: false };
  });

// ---------------- Place outbound call ----------------

export const CallInput = z.object({
  call_type: z.enum(["attendance_alert", "fees_reminder", "announcement", "custom"]),
  trigger_event: z.string().trim().max(120).optional(),
  recipient_name: z.string().trim().min(1).max(160),
  recipient_phone: z.string().trim().min(6).max(32),
  recipient_role: z.enum(["parent", "teacher", "student", "other"]).default("parent"),
  student_id: z.string().uuid().nullable().optional(),
  script: z.string().trim().min(1).max(4000),
});

const GATEWAY_URL = process.env.TWILIO_GATEWAY_URL || "https://api.twilio.com/2010-04-01";

/**
 * Twilio voice-gateway response contract (§21: provider output is untrusted
 * by default). Only the two fields this function consumes are read and
 * bounded; everything else in the response is stripped, never propagated.
 */
export const TwilioCallResponse = z.object({
  sid: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().max(500).optional(),
});

export const placeTwinCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => CallInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: cfg } = await supabase
      .from("digital_twin_config")
      .select("id, is_active")
      .eq("school_id", schoolId)
      .maybeSingle();

    const gatewayKey = process.env.AI_API_KEY || process.env.TWILIO_API_KEY;
    const twilioKey = process.env.TWILIO_API_KEY;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    const baseRow = {
      school_id: schoolId,
      twin_config_id: cfg?.id ?? null,
      call_type: data.call_type,
      trigger_event: data.trigger_event ?? null,
      recipient_name: data.recipient_name,
      recipient_phone: data.recipient_phone,
      recipient_role: data.recipient_role,
      student_id: data.student_id ?? null,
      call_summary: data.script.slice(0, 500),
    };

    if (!gatewayKey || !twilioKey || !twilioFrom) {
      const { data: row, error } = await supabase
        .from("digital_twin_calls")
        .insert({
          ...baseRow,
          call_status: "stub",
          call_outcome: "twilio_not_connected",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        id: row.id,
        status: "stub" as const,
        message:
          "Twilio is not connected — call was logged as a stub. Connect Twilio and set TWILIO_FROM_NUMBER to place real calls.",
      };
    }

    const twiml = `<Response><Say voice="alice">${data.script
      .replace(/</g, "&lt;")
      .replace(/&/g, "&amp;")}</Say></Response>`;

    const resp = await fetch(`${GATEWAY_URL}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: data.recipient_phone,
        From: twilioFrom,
        Twiml: twiml,
      }),
    });
    const parsed = TwilioCallResponse.safeParse(await resp.json().catch(() => ({})));
    const body = parsed.success ? parsed.data : {};
    if (!resp.ok) {
      const { data: row } = await supabase
        .from("digital_twin_calls")
        .insert({
          ...baseRow,
          call_status: "failed",
          call_outcome: body.message ?? `twilio_${resp.status}`,
        })
        .select("id")
        .single();
      throw new Error(
        `Twilio error [${resp.status}]: ${body.message ?? "unknown"} (call id ${row?.id ?? "—"})`,
      );
    }

    const { data: row, error } = await supabase
      .from("digital_twin_calls")
      .insert({
        ...baseRow,
        call_status: "queued",
        twilio_call_sid: body.sid ?? null,
        started_at: timeAuthority.now().at,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, status: "queued" as const, sid: body.sid ?? null };
  });
