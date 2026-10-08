import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME } from "@/lib/platform";
import {
  ONBOARDING_STEPS,
  RUNTIME_OFFERS,
  currentStep,
  mapProvisioningError,
  provisioningErrorMessage,
  slugSchema,
  stepCompleted,
  type OnboardingStep,
} from "@/lib/onboarding/organization-onboarding";
import { createOrganization } from "@/lib/onboarding/create-organization.functions";
import { runtimeWorkspaceHome } from "@/lib/runtime/nav-registry";
import { useServerFn } from "@tanstack/react-start";

/**
 * SHERIVS ORGANIZATION ONBOARDING (§21) — the founder wizard.
 *
 * Reached from /welcome ("Create your organization"). Walks the founder
 * through identity → runtime selection → profile → review, then provisions
 * a real organization via the server function backed by
 * `create_organization_with_founder` (the sole customer write path).
 *
 * The flow asks nothing runtime-specific until the domain runtime is
 * selected (§21: runtime-specific questions are asked only after the
 * founder selects a runtime that provides them).
 */
export const Route = createFileRoute("/_authenticated/onboarding")({
  ssr: false,
  component: OnboardingPage,
});

type Draft = {
  organizationName?: string;
  organizationSlug?: string;
  founderName?: string;
  runtime?: string;
};

function OnboardingPage() {
  const { profile, refresh } = useApp();
  const navigate = useNavigate();
  const create = useServerFn(createOrganization);

  const [draft, setDraft] = useState<Draft>({
    founderName: profile?.full_name ?? "",
  });
  const [step, setStep] = useState<OnboardingStep>("identity");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stage = useMemo<OnboardingStep>(() => currentStep(draft), [draft]);
  const canProceed = stepCompleted(step, draft);

  const proceed = () => {
    if (!canProceed) return;
    const i = ONBOARDING_STEPS.indexOf(step);
    setStep(ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)]);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await create({
        data: {
          organizationName: draft.organizationName!,
          organizationSlug: draft.organizationSlug!,
          founderName: draft.founderName!,
          runtime: "scholar",
        },
      });
      await refresh();
      await navigate({ to: runtimeWorkspaceHome("admin"), replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(provisioningErrorMessage(mapProvisioningError(message)));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {PLATFORM_NAME} onboarding
      </p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
        Set up your organization
      </h1>

      <ol className="mt-6 flex gap-2 text-xs" aria-label="Onboarding progress">
        {ONBOARDING_STEPS.map((s, i) => {
          const active = s === step;
          const done = ONBOARDING_STEPS.indexOf(stage) > i;
          return (
            <li
              key={s}
              aria-current={active ? "step" : undefined}
              className={`rounded-full border px-3 py-1 capitalize ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-border text-foreground"
                    : "border-border text-muted-foreground"
              }`}
            >
              {s}
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {step === "identity" && (
        <div className="mt-8 uos-card p-6">
          <h2 className="font-display text-lg font-semibold">What is your organization called?</h2>
          <label htmlFor="org-name" className="mt-4 block text-sm font-medium">
            Organization name
          </label>
          <input
            id="org-name"
            type="text"
            autoComplete="organization"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={draft.organizationName ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, organizationName: e.target.value }))}
          />
          <button
            type="button"
            onClick={proceed}
            disabled={!canProceed}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === "runtime" && (
        <div className="mt-8 uos-card p-6">
          <h2 className="font-display text-lg font-semibold">What will you run on Sherivs?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A runtime is the domain capability layer of your workspace. Only released runtimes can
            be selected.
          </p>
          <fieldset className="mt-4 grid gap-3">
            <legend className="sr-only">Runtime selection</legend>
            {RUNTIME_OFFERS.map((offer) => (
              <label
                key={offer.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm ${
                  offer.available
                    ? "border-border hover:bg-accent"
                    : "cursor-not-allowed border-border text-muted-foreground"
                } ${draft.runtime === offer.id ? "border-primary ring-1 ring-primary" : ""}`}
              >
                <input
                  type="radio"
                  name="runtime"
                  value={offer.id}
                  disabled={!offer.available}
                  checked={draft.runtime === offer.id}
                  onChange={() => setDraft((d) => ({ ...d, runtime: offer.id }))}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-foreground">{offer.label}</span>
                  <span className="block">{offer.description}</span>
                  {!offer.available && (
                    <span className="mt-1 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest">
                      In development
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={proceed}
            disabled={!canProceed}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      )}

      {step === "profile" && (
        <div className="mt-8 uos-card p-6">
          <h2 className="font-display text-lg font-semibold">Choose your workspace address</h2>
          <label htmlFor="org-slug" className="mt-4 block text-sm font-medium">
            Workspace address
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="org-slug"
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={draft.organizationSlug ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, organizationSlug: e.target.value }))}
            />
            <span className="shrink-0 text-xs text-muted-foreground">.sherivs.com</span>
          </div>
          {draft.organizationSlug && !slugSchema.safeParse(draft.organizationSlug).success && (
            <p className="mt-2 text-xs text-destructive">
              {slugSchema.safeParse(draft.organizationSlug).error?.issues[0]?.message}
            </p>
          )}
          <label htmlFor="founder-name" className="mt-4 block text-sm font-medium">
            Your name
          </label>
          <input
            id="founder-name"
            type="text"
            autoComplete="name"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={draft.founderName ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, founderName: e.target.value }))}
          />
          <button
            type="button"
            onClick={proceed}
            disabled={!canProceed}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Review
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="mt-8 uos-card p-6">
          <h2 className="font-display text-lg font-semibold">Confirm and create</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Organization</dt>
              <dd className="font-medium">{draft.organizationName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Runtime</dt>
              <dd className="font-medium">
                {RUNTIME_OFFERS.find((r) => r.id === draft.runtime)?.label}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Workspace address</dt>
              <dd className="font-medium">{draft.organizationSlug}.sherivs.com</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Founder</dt>
              <dd className="font-medium">{draft.founderName}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            You will be the organization administrator. Your workspace starts minimal and configures
            itself from here.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create organization"}
          </button>
        </div>
      )}
    </div>
  );
}
