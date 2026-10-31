/**
 * HTTP adapters for native (iOS/Android) passkey ceremonies.
 *
 * Browser login does not call these routes. Native apps use the platform RP
 * origin (https://sherivs.com). Custom school domains are not portable RP IDs
 * for sherivs.com credentials.
 *
 * Email confirmation is invite-time only. Session minting refuses an
 * unconfirmed address and never sets email_confirm.
 */
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { WEBAUTHN_PUBLIC_ERROR } from "./webauthn-policy";
import { nativeCeremonyOrigin } from "./webauthn-relying-party";
import { WebAuthnServiceError } from "./webauthn.server";

export const RegistrationResponseSchema = z.object({
  id: z.string().min(16).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(16).max(16_384),
    attestationObject: z.string().min(16).max(65_536),
    transports: z.array(z.string().max(32)).max(12).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().max(4096).optional(),
    authenticatorData: z.string().max(16_384).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const AuthenticationResponseSchema = z.object({
  id: z.string().min(16).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(16).max(16_384),
    authenticatorData: z.string().min(16).max(16_384),
    signature: z.string().min(16).max(16_384),
    userHandle: z.string().max(256).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const PublicWebAuthnBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("authentication.options") }),
  z.object({
    action: z.literal("authentication.verify"),
    response: AuthenticationResponseSchema,
  }),
]);

export const AuthedWebAuthnBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("registration.options") }),
  z.object({
    action: z.literal("registration.verify"),
    response: RegistrationResponseSchema,
    label: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal("credentials.list") }),
  z.object({
    action: z.literal("credentials.remove"),
    credentialId: z.string().uuid(),
  }),
  z.object({ action: z.literal("onboarding.state") }),
  z.object({ action: z.literal("onboarding.dismiss") }),
]);

export class WebAuthnHttpError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.name = "WebAuthnHttpError";
  }
}

export function jsonWebAuthnError(err: unknown): Response {
  if (err instanceof WebAuthnHttpError) {
    return Response.json({ error: err.message }, { status: err.httpStatus });
  }
  if (err instanceof WebAuthnServiceError) {
    return Response.json({ error: err.message }, { status: err.httpStatus });
  }
  if (err instanceof z.ZodError) {
    return Response.json({ error: WEBAUTHN_PUBLIC_ERROR.unavailable }, { status: 400 });
  }
  return Response.json({ error: WEBAUTHN_PUBLIC_ERROR.unavailable }, { status: 503 });
}

export async function loadNativeWebAuthn() {
  const { createProductionWebAuthnService } = await import("./webauthn-supabase.server");
  const service = await createProductionWebAuthnService();
  const origin = nativeCeremonyOrigin(service.platformConfig);
  return { service, origin };
}

export function nativeRateKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  return `ip:${clientIpFromHeaders(request.headers)}`;
}

export async function userIdFromBearer(request: Request): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new WebAuthnHttpError(401, WEBAUTHN_PUBLIC_ERROR.unauthorized);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) {
    throw new WebAuthnHttpError(401, WEBAUTHN_PUBLIC_ERROR.unauthorized);
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishable) {
    throw new WebAuthnHttpError(503, WEBAUTHN_PUBLIC_ERROR.unavailable);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, publishable, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string" || userId.length < 1) {
    throw new WebAuthnHttpError(401, WEBAUTHN_PUBLIC_ERROR.unauthorized);
  }
  return userId;
}
