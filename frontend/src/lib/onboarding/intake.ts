/**
 * M5 part B (ADR-108): the public onboarding intake contract, shared by the form and the server.
 *
 * Pure: no I/O, no clock. The server (intake.server.ts) is the enforcer; the form reuses the same
 * schema only to show errors early. Answers are opaque, bounded JSON; this module never interprets
 * them (the question graph and plan generator own their meaning).
 */
import { z } from "zod";

/** Version of the consent wording the visitor accepted. Bump it whenever that wording changes. */
export const INTAKE_CONSENT_VERSION = "intake-2026-11-17";

/**
 * Graph version recorded on a new session until the question graph ships its own version id.
 * The interview mission replaces this with the graph's version.
 */
export const INTAKE_PENDING_GRAPH_VERSION = "pending-graph";

/** Upper bound of the answers document, in UTF-8 bytes of its JSON text (matches the database CHECK). */
export const INTAKE_ANSWERS_MAX_BYTES = 65_536;

export const INTAKE_SOURCES = ["public_onboarding", "public_demo"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

/** Field name of the honeypot. A person never sees or fills it; it must arrive empty. */
export const INTAKE_HONEYPOT_FIELD = "website";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const IntakeRequestSchema = z.object({
  orgName: z.string().trim().min(2).max(160),
  institutionType: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,63}$/),
  state: optionalText(64),
  lga: optionalText(80),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z
    .string()
    .trim()
    .min(6)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  contactPhone: z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || /^\+?[0-9][0-9 ()-]{5,22}$/.test(value)),
  contactRole: optionalText(120),
  note: optionalText(2000),
  consent: z.literal(true),
  source: z.enum(INTAKE_SOURCES),
  /** Honeypot: any value is treated as automated. Bounded so it cannot carry a large body. */
  website: z.string().max(200).optional(),
  captchaToken: z.string().min(1).max(4096).optional(),
});
export type IntakeRequestInput = z.input<typeof IntakeRequestSchema>;
export type IntakeRequest = z.output<typeof IntakeRequestSchema>;

/** A resume token: 32 random bytes as base64url (43 characters). */
export const ResumeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const IntakeLoadSchema = z.object({ resumeToken: ResumeTokenSchema });

export function answersByteLength(answers: unknown): number {
  return new TextEncoder().encode(JSON.stringify(answers)).length;
}

export const IntakeAnswersSchema = z
  .record(z.string().min(1).max(128), z.unknown())
  .refine((answers) => answersByteLength(answers) <= INTAKE_ANSWERS_MAX_BYTES, {
    message: "answers too large",
  });

export const IntakeSaveSchema = z.object({
  resumeToken: ResumeTokenSchema,
  expectedRevision: z.number().int().min(0).max(1_000_000),
  answers: IntakeAnswersSchema,
  completionPct: z.number().int().min(0).max(100),
});

export const IntakeCompleteSchema = z.object({
  resumeToken: ResumeTokenSchema,
  expectedRevision: z.number().int().min(0).max(1_000_000),
});

/** What a visitor may see about their own session. Never the token hash, never request ids. */
export type IntakeSessionView = {
  graphVersion: string;
  revision: number;
  completionPct: number;
  completed: boolean;
  expiresAt: string;
};

export type IntakeFailureCode =
  "invalid" | "rate_limited" | "captcha_required" | "not_found" | "stale" | "unavailable";

export type IntakeFailure = {
  ok: false;
  code: IntakeFailureCode;
  /** Field names that failed validation (never the submitted values). */
  fields?: string[];
  retryAfterSeconds?: number;
};

export type IntakeSubmitResult =
  { ok: true; resumeToken: string; session: IntakeSessionView } | IntakeFailure;

/** JSON as stored in the answers column. */
export type IntakeJson =
  string | number | boolean | null | IntakeJson[] | { [key: string]: IntakeJson };

export type IntakeLoadResult =
  { ok: true; session: IntakeSessionView; answers: { [key: string]: IntakeJson } } | IntakeFailure;

export type IntakeSaveResult = { ok: true; session: IntakeSessionView } | IntakeFailure;

/** Field names from a zod error, for the form to mark. Values are never echoed. */
export function invalidFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "form")))];
}
