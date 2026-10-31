/**
 * Password sign-in for organization-issued ID numbers.
 * Email and phone stay on the existing client GoTrue path so this function
 * never returns whether an identifier exists — it only returns a session or
 * the same generic failure used by password login.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { INVITE_LOGIN_ERROR } from "./sign-in-identifier";

const Payload = z.object({
  identifier: z.string().trim().min(1).max(180),
  password: z.string().min(1).max(256),
  captchaToken: z.string().min(1).max(4096).optional(),
});

export const signInWithOrgIdentifier = createServerFn({ method: "POST" })
  .validator((input: unknown) => Payload.parse(input))
  .handler(async ({ data }) => {
    const { checkPublicRateLimit } = await import("@/lib/security/public-rate-limit.server");
    const ip = clientIpFromHeaders(getRequest().headers);
    const limited = await checkPublicRateLimit("org-id-login", `ip:${ip}`, {
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!limited.allowed) throw new Error(INVITE_LOGIN_ERROR);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createPasswordAuthClient, hostnameFromOriginHeader, passwordSignInFromIdentifier } =
      await import("./resolve-sign-in-identifier.server");

    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error(INVITE_LOGIN_ERROR);

    const origin = getRequest().headers.get("origin");
    const result = await passwordSignInFromIdentifier({
      rawIdentifier: data.identifier,
      password: data.password,
      captchaToken: data.captchaToken,
      originHost: hostnameFromOriginHeader(origin),
      admin: supabaseAdmin as never,
      client: createPasswordAuthClient(url, key),
    });
    if (!result.ok) throw new Error(INVITE_LOGIN_ERROR);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      userId: result.userId,
    };
  });
