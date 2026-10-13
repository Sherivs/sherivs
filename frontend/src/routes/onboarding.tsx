/**
 * Sherivs organization onboarding (Plane A → Plane C).
 * Education-specific questions appear only when the Scholar runtime is selected.
 * Persistence of a new tenant still requires an authorized provisioner
 * (`provisionOrganization` is super-admin gated). This surface collects the
 * domain-neutral request and validates it through the onboarding contract.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME } from "@/lib/platform";
import { resolveIdentityGateway } from "@/lib/identity/identity-gateway";
import { INSTALLED_RUNTIME_ID } from "@/lib/runtime/installed-runtimes";
import { createOrganizationOnboarding } from "@/lib/onboarding/onboarding-flow";
import { resolveExperienceHost } from "@/lib/experience/experience-host";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  component: OrganizationOnboardingPage,
});

const ORG_TYPES = [
  { id: "company", label: "Company / enterprise" },
  { id: "school", label: "School / education" },
  { id: "government_agency", label: "Government agency" },
  { id: "non_profit", label: "Non-profit" },
  { id: "community_institution", label: "Community institution" },
  { id: "other", label: "Other" },
] as const;

type RuntimeChoice = "none" | "runtime:scholar";

function OrganizationOnboardingPage() {
  const { loading, session, role, superAdmin, profile, tenantSlug, school } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState<string>("company");
  const [runtime, setRuntime] = useState<RuntimeChoice>("none");
  const [grades, setGrades] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const hostKind = useMemo(
    () => (typeof window === "undefined" ? "local" : resolveExperienceHost(window.location.hostname)),
    [],
  );

  useEffect(() => {
    if (loading) return;
    const decision = resolveIdentityGateway({
      authenticated: Boolean(session),
      role,
      superAdmin: Boolean(superAdmin),
      tenantSlug,
      organizationSlug: school?.slug ?? null,
      hasOrganizationMembership: Boolean(profile && role),
      installedRuntimeId: INSTALLED_RUNTIME_ID,
      hostKind,
    });
    if (decision.destination && decision.destination !== "/onboarding" && decision.reason !== "unlinked_identity") {
      void navigate({ to: decision.destination as never, replace: true });
    }
  }, [loading, session, role, superAdmin, profile, tenantSlug, school?.slug, hostKind, navigate]);

  if (loading) {
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="min-h-dvh grid place-items-center px-4">
        <div className="uos-card max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-bold">Sign in to continue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Organization onboarding requires an authenticated {PLATFORM_NAME} identity.
          </p>
          <Link
            to="/auth"
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const onboardingId = `onboarding:${crypto.randomUUID()}`;
    const organizationId = `org:${crypto.randomUUID()}`;
    const result = createOrganizationOnboarding({
      onboardingId,
      organizationId,
      orgType,
      actor: session?.user.id ?? "unknown",
      createdAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setIssues(result.issues);
      setSubmittedId(null);
      return;
    }
    setIssues([]);
    setSubmittedId(result.onboarding.onboardingId);
  }

  const scholarSelected = runtime === "runtime:scholar" || orgType === "school";

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-lg uos-card space-y-5 p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {PLATFORM_NAME}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold">Create an organization</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Domain-neutral first. Education questions appear only when the education runtime is chosen.
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Organization name
          </span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="uos-input"
            autoComplete="organization"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Organization type
          </span>
          <select
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
            className="uos-input"
          >
            {ORG_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
            Domain runtime
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="runtime"
              checked={runtime === "none"}
              onChange={() => setRuntime("none")}
            />
            None yet — platform workspace only
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="runtime"
              checked={runtime === "runtime:scholar"}
              onChange={() => setRuntime("runtime:scholar")}
            />
            Sherivs Scholar (education)
          </label>
        </fieldset>

        {scholarSelected && (
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Grade bands / programmes (Scholar only)
            </span>
            <input
              value={grades}
              onChange={(e) => setGrades(e.target.value)}
              className="uos-input"
              placeholder="e.g. Primary, JSS, SSS"
            />
          </label>
        )}

        {issues.length > 0 && (
          <ul className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}

        {submittedId ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Request {submittedId} is valid. Creating the live tenant still requires an authorized
            {PLATFORM_NAME} operator (`provisionOrganization`). Your account stays unlinked until
            that provision completes.
          </div>
        ) : (
          <button type="submit" className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground">
            Validate organization request
          </button>
        )}

        <Link to="/auth" className="block text-center text-xs text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </form>
      <style>{`.uos-input{display:block;width:100%;border-radius:.5rem;background:var(--color-surface-2);border:1px solid var(--color-border);padding:.55rem .75rem;color:var(--color-foreground);outline:none}.uos-input:focus{box-shadow:0 0 0 2px var(--color-ring)}`}</style>
    </div>
  );
}
