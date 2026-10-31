import { describe, expect, it } from "vitest";
import {
  WebAuthnSessionError,
  createSupabaseWebAuthnSessionMinter,
  type SupabaseAuthAdmin,
} from "../../frontend/src/lib/auth/webauthn-session.server";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function admin(overrides?: {
  email?: string | null;
  confirmed?: boolean;
  hashed?: string | null;
  sessionUser?: string;
  verifyType?: Array<"magiclink" | "email">;
}): SupabaseAuthAdmin {
  const used: Array<"magiclink" | "email"> = [];
  return {
    auth: {
      admin: {
        async getUserById(id: string) {
          return {
            data: {
              user: {
                id,
                email: overrides?.email === undefined ? "owner@sherivs.com" : overrides.email,
                email_confirmed_at: overrides?.confirmed === false ? null : "2026-01-01T00:00:00Z",
              },
            },
            error: null,
          };
        },
        async generateLink() {
          return {
            data: {
              properties: {
                hashed_token: overrides?.hashed === undefined ? "hashed-token" : overrides.hashed,
              },
            },
            error: null,
          };
        },
      },
      async verifyOtp(args) {
        used.push(args.type);
        overrides?.verifyType?.push(args.type);
        if (args.token_hash !== (overrides?.hashed ?? "hashed-token")) {
          return { data: { session: null }, error: { message: "bad token" } };
        }
        if (args.type === "magiclink") {
          return {
            data: {
              session: {
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 3600,
                user: { id: overrides?.sessionUser ?? USER },
              },
            },
            error: null,
          };
        }
        return { data: { session: null }, error: { message: "unsupported" } };
      },
    },
  };
}

describe("Supabase session minting after WebAuthn", () => {
  it("mints access and refresh tokens through generateLink + verifyOtp", async () => {
    const minter = createSupabaseWebAuthnSessionMinter(admin());
    const session = await minter.mint(USER);
    expect(session).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      userId: USER,
    });
  });

  it("refuses to mint for an email-less or unconfirmed user", async () => {
    await expect(
      createSupabaseWebAuthnSessionMinter(admin({ email: null })).mint(USER),
    ).rejects.toBeInstanceOf(WebAuthnSessionError);
    await expect(
      createSupabaseWebAuthnSessionMinter(admin({ confirmed: false })).mint(USER),
    ).rejects.toMatchObject({ code: "email_unconfirmed" });
  });

  it("does not confirm email because a passkey exists", async () => {
    let generated = 0;
    const inner = admin({ confirmed: false });
    const wrapped: SupabaseAuthAdmin = {
      auth: {
        admin: {
          getUserById: inner.auth.admin.getUserById,
          generateLink: async (args) => {
            generated += 1;
            return inner.auth.admin.generateLink(args);
          },
        },
        verifyOtp: inner.auth.verifyOtp,
      },
    };
    await expect(createSupabaseWebAuthnSessionMinter(wrapped).mint(USER)).rejects.toMatchObject({
      code: "email_unconfirmed",
    });
    expect(generated).toBe(0);
  });

  it("refuses tokens issued for a different user", async () => {
    const minter = createSupabaseWebAuthnSessionMinter(admin({ sessionUser: "someone-else" }));
    await expect(minter.mint(USER)).rejects.toMatchObject({ code: "session_unavailable" });
  });
});
