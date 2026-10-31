/**
 * WebAuthn server functions.
 *
 * Registration / listing / rename / removal require an authenticated Sherivs
 * session (requireSupabaseAuth). Authentication options and verification are
 * public but rate-limited; identity comes from the verified credential, never
 * from a client-supplied user id.
 *
 * SimpleWebAuthn and the service-role client are loaded inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { WEBAUTHN_PUBLIC_ERROR } from "./webauthn-policy";

const RegistrationResponseSchema = z.object({
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

const AuthenticationResponseSchema = z.object({
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

function publicError(err: unknown): never {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const message = String((err as { message: unknown }).message);
    if (
      Object.values(WEBAUTHN_PUBLIC_ERROR).includes(
        message as (typeof WEBAUTHN_PUBLIC_ERROR)[keyof typeof WEBAUTHN_PUBLIC_ERROR],
      )
    ) {
      throw new Error(message);
    }
  }
  throw new Error(WEBAUTHN_PUBLIC_ERROR.unavailable);
}

async function loadService() {
  const { createProductionWebAuthnService, requestOrigin } =
    await import("./webauthn-supabase.server");
  return { service: await createProductionWebAuthnService(), origin: requestOrigin(getRequest()) };
}

function rateKey(userId?: string): string {
  if (userId) return `user:${userId}`;
  return `ip:${clientIpFromHeaders(getRequest().headers)}`;
}

export const getPasskeyRegistrationOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.registrationOptions({
        userId: context.userId,
        origin,
        rateKey: rateKey(context.userId),
      });
    } catch (err) {
      publicError(err);
    }
  });

export const verifyPasskeyRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        response: RegistrationResponseSchema,
        label: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.verifyRegistration({
        userId: context.userId,
        origin,
        rateKey: rateKey(context.userId),
        response: data.response as never,
        label: data.label,
      });
    } catch (err) {
      publicError(err);
    }
  });

export const getPasskeyAuthenticationOptions = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const { service, origin } = await loadService();
      return await service.authenticationOptions({
        origin,
        rateKey: rateKey(),
      });
    } catch (err) {
      publicError(err);
    }
  },
);

export const verifyPasskeyAuthentication = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ response: AuthenticationResponseSchema }).parse(input))
  .handler(async ({ data }) => {
    try {
      const { service, origin } = await loadService();
      const session = await service.verifyAuthentication({
        origin,
        rateKey: rateKey(),
        response: data.response as never,
      });
      return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
        userId: session.userId,
      };
    } catch (err) {
      publicError(err);
    }
  });

export const listPasskeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.list({ userId: context.userId, origin });
    } catch (err) {
      publicError(err);
    }
  });

export const renamePasskey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ credentialId: z.string().uuid(), label: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      const { service } = await loadService();
      return await service.rename({
        userId: context.userId,
        credentialId: data.credentialId,
        label: data.label,
      });
    } catch (err) {
      publicError(err);
    }
  });

export const removePasskey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ credentialId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { service } = await loadService();
      return await service.remove({
        userId: context.userId,
        credentialId: data.credentialId,
        rateKey: rateKey(context.userId),
      });
    } catch (err) {
      publicError(err);
    }
  });

export const getPasskeyOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.onboardingState({ userId: context.userId, origin });
    } catch (err) {
      publicError(err);
    }
  });

export const dismissPasskeyOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.dismissOnboarding({ userId: context.userId, origin });
    } catch (err) {
      publicError(err);
    }
  });

export const setPasskeyFirstPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ passkeyFirst: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    try {
      const { service, origin } = await loadService();
      return await service.setPasskeyFirst({
        userId: context.userId,
        passkeyFirst: data.passkeyFirst,
        origin,
      });
    } catch (err) {
      publicError(err);
    }
  });
