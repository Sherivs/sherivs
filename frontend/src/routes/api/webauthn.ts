import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import {
  AuthedWebAuthnBodySchema,
  jsonWebAuthnError,
  loadNativeWebAuthn,
  nativeRateKey,
  userIdFromBearer,
} from "@/lib/auth/webauthn-http.server";

export const Route = createFileRoute("/api/webauthn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await userIdFromBearer(request);
          const body = AuthedWebAuthnBodySchema.parse(await request.json());
          const { service, origin } = await loadNativeWebAuthn();
          const rateKey = nativeRateKey(request, userId);
          if (body.action === "registration.options") {
            return Response.json(await service.registrationOptions({ userId, origin, rateKey }));
          }
          if (body.action === "registration.verify") {
            return Response.json(
              await service.verifyRegistration({
                userId,
                origin,
                rateKey,
                response: body.response as never,
                label: body.label,
              }),
            );
          }
          if (body.action === "credentials.list") {
            return Response.json(await service.list({ userId, origin }));
          }
          if (body.action === "credentials.remove") {
            return Response.json(
              await service.remove({ userId, credentialId: body.credentialId, rateKey }),
            );
          }
          if (body.action === "onboarding.state") {
            return Response.json(await service.onboardingState({ userId, origin }));
          }
          return Response.json(await service.dismissOnboarding({ userId, origin }));
        } catch (err) {
          return jsonWebAuthnError(err);
        }
      },
    },
  },
});
