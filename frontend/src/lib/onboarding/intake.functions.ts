/**
 * M5 part B (ADR-108): public, unauthenticated server functions for the onboarding intake.
 *
 * Same pattern as resolve-sign-in-identifier.functions.ts: POST only, the caller address comes
 * from clientIpFromHeaders (platform-observed, not caller-chosen), and the work is done by
 * intake.server.ts with the service role. The validator only bounds the envelope size; the
 * handler runs the full zod schema after the rate limit so floods are cheap to refuse.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/security/request-safety";

/** Envelope bound: an object whose JSON text is at most 80 KB (answers are capped at 64 KB). */
const Envelope = z
  .record(z.string().max(64), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 80_000);

function callerIp(): string {
  return clientIpFromHeaders(getRequest().headers);
}

export const submitOnboardingRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => Envelope.parse(input))
  .handler(async ({ data }) => {
    const { productionIntakeDeps, submitIntake } = await import("./intake.server");
    return submitIntake(data, callerIp(), await productionIntakeDeps());
  });

export const loadOnboardingSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => Envelope.parse(input))
  .handler(async ({ data }) => {
    const { productionIntakeDeps, loadIntakeSession } = await import("./intake.server");
    return loadIntakeSession(data, callerIp(), await productionIntakeDeps());
  });

export const saveOnboardingAnswers = createServerFn({ method: "POST" })
  .validator((input: unknown) => Envelope.parse(input))
  .handler(async ({ data }) => {
    const { productionIntakeDeps, saveIntakeAnswers } = await import("./intake.server");
    return saveIntakeAnswers(data, callerIp(), await productionIntakeDeps());
  });

export const completeOnboardingSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => Envelope.parse(input))
  .handler(async ({ data }) => {
    const { productionIntakeDeps, completeIntakeSession } = await import("./intake.server");
    return completeIntakeSession(data, callerIp(), await productionIntakeDeps());
  });
