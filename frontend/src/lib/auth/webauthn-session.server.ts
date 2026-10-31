/**
 * Mint a real Supabase Auth session after a verified WebAuthn assertion.
 *
 * A verified passkey is not a session. GoTrue still issues the access and
 * refresh tokens via generateLink + verifyOtp, which is the same provider
 * that password and Google sign-in use. Tokens never enter logs.
 */
import type { MintedSupabaseSession, WebAuthnSessionMinter } from "./webauthn-store";

type GenerateLinkResult = {
  data: { properties?: { hashed_token?: string | null } | null } | null;
  error: { message: string } | null;
};

type VerifyOtpResult = {
  data: {
    session?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user?: { id?: string };
    } | null;
  } | null;
  error: { message: string } | null;
};

export type SupabaseAuthAdmin = {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: {
          user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
        };
        error: { message: string } | null;
      }>;
      generateLink(args: { type: "magiclink"; email: string }): Promise<GenerateLinkResult>;
    };
    verifyOtp(args: { type: "magiclink" | "email"; token_hash: string }): Promise<VerifyOtpResult>;
  };
};

export class WebAuthnSessionError extends Error {
  readonly code: "email_required" | "email_unconfirmed" | "session_unavailable";
  constructor(
    code: "email_required" | "email_unconfirmed" | "session_unavailable",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export function createSupabaseWebAuthnSessionMinter(
  admin: SupabaseAuthAdmin,
): WebAuthnSessionMinter {
  return {
    async mint(userId: string): Promise<MintedSupabaseSession> {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
      const user = userData?.user;
      if (userError || !user) {
        throw new WebAuthnSessionError("session_unavailable", "auth user not found");
      }
      const email = user.email?.trim();
      if (!email) {
        throw new WebAuthnSessionError(
          "email_required",
          "passkey session requires a confirmed email",
        );
      }
      // Invite-time property only. A passkey must not confirm the address.
      if (!user.email_confirmed_at) {
        throw new WebAuthnSessionError(
          "email_unconfirmed",
          "passkey session requires a confirmed email",
        );
      }

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      const hashed = link?.properties?.hashed_token;
      if (linkError || !hashed) {
        throw new WebAuthnSessionError("session_unavailable", "session link was not issued");
      }

      let verified = await admin.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
      if (verified.error || !verified.data?.session?.access_token) {
        verified = await admin.auth.verifyOtp({ type: "email", token_hash: hashed });
      }
      const session = verified.data?.session;
      if (
        verified.error ||
        !session?.access_token ||
        !session.refresh_token ||
        session.user?.id !== userId
      ) {
        throw new WebAuthnSessionError("session_unavailable", "session tokens were not issued");
      }

      return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in ?? 3600,
        userId,
      };
    },
  };
}
