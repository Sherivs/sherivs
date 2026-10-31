import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import {
  PublicWebAuthnBodySchema,
  jsonWebAuthnError,
  loadNativeWebAuthn,
  nativeRateKey,
} from "@/lib/auth/webauthn-http.server";

export const Route = createFileRoute("/api/public/webauthn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = PublicWebAuthnBodySchema.parse(await request.json());
          const { service, origin } = await loadNativeWebAuthn();
          const rateKey = nativeRateKey(request);
          if (body.action === "authentication.options") {
            const options = await service.authenticationOptions({ origin, rateKey });
            return Response.json(options);
          }
          const session = await service.verifyAuthentication({
            origin,
            rateKey,
            response: body.response as never,
          });
          return Response.json({
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresIn: session.expiresIn,
            userId: session.userId,
          });
        } catch (err) {
          return jsonWebAuthnError(err);
        }
      },
    },
  },
});
